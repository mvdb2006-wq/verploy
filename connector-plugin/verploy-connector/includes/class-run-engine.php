<?php
/**
 * De update-engine: staging bouwen, updates uitvoeren, snapshot maken, onderhoudsmodus,
 * rollback en opruimen. Elke stap is idempotent en hervatbaar; de worker (Verploy-cloud)
 * roept ze via ondertekende REST-verzoeken aan (zie PLAN.md §5).
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Run_Engine {

	const STATE_OPTION       = 'verploy_run_state';
	const MAINTENANCE_OPTION = 'verploy_maintenance';

	/** Mappen/bestanden in wp-content die nooit naar staging gaan. */
	const CONTENT_EXCLUDES = array(
		'verploy-staging', 'verploy-backups', 'cache', 'upgrade', 'upgrade-temp-backup', 'ai1wm-backups',
		'updraft', 'backups-dup-lite', 'backup-db', 'wflogs', 'et-cache',
		'object-cache.php', 'advanced-cache.php', 'db.php', 'debug.log',
	);

	// ── Hulpfuncties ─────────────────────────────────────────────────────────

	public static function short_id( $run_id ) {
		return substr( str_replace( '-', '', strtolower( (string) $run_id ) ), 0, 8 );
	}

	public static function valid_run_id( $run_id ) {
		return (bool) preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', (string) $run_id );
	}

	private static function state( $run_id ) {
		$all = get_option( self::STATE_OPTION );
		return ( is_array( $all ) && isset( $all['run_id'] ) && $all['run_id'] === $run_id ) ? $all : array( 'run_id' => $run_id );
	}

	private static function save_state( array $state ) {
		update_option( self::STATE_OPTION, $state, false );
	}

	/** Token waarmee de worker (en alleen de worker) de staging-kopie mag bekijken. */
	public static function staging_token( $run_id ) {
		return hash_hmac( 'sha256', 'staging|' . $run_id, Verploy_Connection::secret() );
	}

	/** Token waarmee de worker tijdens onderhoudsmodus de productiesite mag testen. */
	public static function bypass_token( $run_id ) {
		return hash_hmac( 'sha256', 'bypass|' . $run_id, Verploy_Connection::secret() );
	}

	public static function staging_paths( $run_id ) {
		$short = self::short_id( $run_id );
		return array(
			'dir'    => Verploy_File_Copier::norm( WP_CONTENT_DIR ) . '/verploy-staging/' . $short,
			'url'    => untrailingslashit( content_url( 'verploy-staging/' . $short ) ),
			'prefix' => 'vpst' . $short . '_',
		);
	}

	private static function assert_supported_database() {
		global $wpdb;
		if ( defined( 'DB_ENGINE' ) && 'sqlite' === DB_ENGINE ) {
			throw new RuntimeException( 'unsupported_database:sqlite' );
		}
		if ( ! ( $wpdb instanceof wpdb ) || ! method_exists( $wpdb, 'db_server_info' ) ) {
			throw new RuntimeException( 'unsupported_database' );
		}
	}

	private static function protect_dir( $dir ) {
		wp_mkdir_p( $dir );
		if ( ! file_exists( $dir . '/index.php' ) ) {
			file_put_contents( $dir . '/index.php', "<?php // Silence is golden.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
	}

	// ── Staging ──────────────────────────────────────────────────────────────

	/**
	 * Bouwt (verder aan) de staging-kopie. Herhaaldelijk aanroepen tot state = ready.
	 *
	 * @return array{state:string,progress:array,url:string,token:string}
	 */
	public static function staging_build( $run_id, Verploy_Budget $budget ) {
		global $wpdb;
		self::assert_supported_database();
		$state = self::state( $run_id );
		$p     = self::staging_paths( $run_id );
		$s     = isset( $state['staging'] ) ? $state['staging'] : array( 'phase' => 'init' );

		if ( 'init' === $s['phase'] ) {
			self::protect_dir( dirname( $p['dir'] ) );
			Verploy_File_Copier::delete_tree( $p['dir'] );
			wp_mkdir_p( $p['dir'] );
			$abs     = Verploy_File_Copier::norm( ABSPATH );
			$content = Verploy_File_Copier::norm( WP_CONTENT_DIR );
			$roots   = array( $abs . '/wp-admin' => $p['dir'] . '/wp-admin', $abs . '/wp-includes' => $p['dir'] . '/wp-includes' );
			foreach ( (array) glob( $abs . '/*.php' ) as $f ) {
				if ( 'wp-config.php' !== basename( $f ) ) {
					$roots[ $f ] = $p['dir'] . '/' . basename( $f );
				}
			}
			$roots[ $content ] = $p['dir'] . '/wp-content';
			$excludes          = array_map(
				function ( $x ) use ( $content ) {
					return $content . '/' . $x;
				},
				self::CONTENT_EXCLUDES
			);
			$uploads           = wp_upload_dir( null, false );
			$excludes[]        = $uploads['basedir'];
			$excludes[]        = Verploy_File_Copier::norm( self::rescue_path() );
			$manifest          = $p['dir'] . '/.verploy-manifest';
			$s['files_total']  = Verploy_File_Copier::build_manifest( $roots, $excludes, $manifest );
			$s['files_done']   = 0;
			$s['tables']       = array();
			$s['phase']        = 'files';
			$state['staging']  = $s;
			self::save_state( $state );
		}

		if ( 'files' === $s['phase'] ) {
			$s['files_done'] = Verploy_File_Copier::copy_step( $p['dir'] . '/.verploy-manifest', (int) $s['files_done'], $budget );
			if ( $s['files_done'] >= $s['files_total'] ) {
				$s['phase'] = 'tables';
			}
			$state['staging'] = $s;
			self::save_state( $state );
		}

		if ( 'tables' === $s['phase'] && ! $budget->expired() ) {
			$tables_state = $s['tables'];
			$done         = Verploy_Table_Copier::copy_step( $wpdb->prefix, $p['prefix'], $tables_state, $budget );
			$s['tables']  = $tables_state;
			if ( $done ) {
				$s['phase'] = 'finalize';
			}
			$state['staging'] = $s;
			self::save_state( $state );
		}

		if ( 'finalize' === $s['phase'] && ! $budget->expired() ) {
			self::finalize_staging( $run_id, $p );
			$s['phase']       = 'ready';
			$state['staging'] = $s;
			self::save_state( $state );
		}

		$tables = isset( $s['tables']['tables'] ) ? count( $s['tables']['tables'] ) : 0;
		return array(
			'state'    => 'ready' === $s['phase'] ? 'ready' : 'building',
			'progress' => array(
				'phase'       => $s['phase'],
				'files_done'  => (int) ( isset( $s['files_done'] ) ? $s['files_done'] : 0 ),
				'files_total' => (int) ( isset( $s['files_total'] ) ? $s['files_total'] : 0 ),
				'tables_done' => (int) ( isset( $s['tables']['index'] ) ? $s['tables']['index'] : 0 ),
				'tables_total'=> $tables,
			),
			'url'      => $p['url'],
			'token'    => self::staging_token( $run_id ),
		);
	}

	private static function finalize_staging( $run_id, array $p ) {
		global $wpdb;
		$old = $wpdb->prefix;
		$new = $p['prefix'];
		$q   = array( 'Verploy_Table_Copier', 'quote' );

		// Prefix-afhankelijke sleutels (rollen, gebruikersrechten) meenemen naar de nieuwe prefix.
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . call_user_func( $q, $new . 'options' ) . ' SET option_name = %s WHERE option_name = %s', $new . 'user_roles', $old . 'user_roles' ) ); // phpcs:ignore WordPress.DB.PreparedSQL
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . call_user_func( $q, $new . 'usermeta' ) . ' SET meta_key = CONCAT(%s, SUBSTRING(meta_key, %d)) WHERE meta_key LIKE %s', $new, strlen( $old ) + 1, $wpdb->esc_like( $old ) . '%' ) ); // phpcs:ignore WordPress.DB.PreparedSQL
		// Staging: geen zoekmachines, gewone permalinks (werken zonder serverconfiguratie), geen cron.
		foreach ( array( 'blog_public' => '0', 'permalink_structure' => '' ) as $name => $value ) {
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . call_user_func( $q, $new . 'options' ) . ' SET option_value = %s WHERE option_name = %s', $value, $name ) ); // phpcs:ignore WordPress.DB.PreparedSQL
		}
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . call_user_func( $q, $new . 'options' ) . ' WHERE option_name IN (%s, %s, %s)', 'cron', 'rewrite_rules', Verploy_Heartbeat::OPT_LAST ) ); // phpcs:ignore WordPress.DB.PreparedSQL

		$uploads  = wp_upload_dir( null, false );
		$consts   = array();
		foreach ( array( 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_CHARSET', 'DB_COLLATE', 'AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT', 'WP_MEMORY_LIMIT', 'WP_MAX_MEMORY_LIMIT', 'VERPLOY_API_BASE' ) as $c ) {
			if ( defined( $c ) ) {
				$consts[] = 'define( ' . var_export( $c, true ) . ', ' . var_export( constant( $c ), true ) . ' );'; // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			}
		}
		$config = "<?php\n// Verploy staging voor run {$run_id}. Automatisch aangemaakt en weer verwijderd; niet bewerken.\n"
			. implode( "\n", $consts ) . "\n"
			. "define( 'VERPLOY_STAGING', true );\n"
			. 'define( \'VERPLOY_STAGING_RUN\', ' . var_export( $run_id, true ) . " );\n" // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			. 'define( \'WP_HOME\', ' . var_export( $p['url'], true ) . " );\n" // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			. 'define( \'WP_SITEURL\', ' . var_export( $p['url'], true ) . " );\n" // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			. "define( 'WP_CONTENT_DIR', __DIR__ . '/wp-content' );\n"
			. 'define( \'WP_CONTENT_URL\', ' . var_export( $p['url'] . '/wp-content', true ) . " );\n" // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			. "define( 'DISABLE_WP_CRON', true );\ndefine( 'WP_DEBUG', true );\ndefine( 'WP_DEBUG_DISPLAY', false );\ndefine( 'WP_DEBUG_LOG', __DIR__ . '/verploy-debug.log' );\n"
			. 'define( \'VERPLOY_PROD_UPLOADS_URL\', ' . var_export( $uploads['baseurl'], true ) . " );\n" // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			. '$table_prefix = ' . var_export( $p['prefix'], true ) . ";\n" // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			. "if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }\nrequire_once ABSPATH . 'wp-settings.php';\n";
		file_put_contents( $p['dir'] . '/wp-config.php', $config ); // phpcs:ignore WordPress.WP.AlternativeFunctions

		$guard = "<?php\n// Verploy staging-beveiliging (automatisch aangemaakt).\nif ( ! defined( 'ABSPATH' ) ) { exit; }\n"
			. 'define( \'VERPLOY_STAGING_TOKEN_HASH\', ' . var_export( hash( 'sha256', self::staging_token( $run_id ) ), true ) . " );\n" // phpcs:ignore WordPress.PHP.DevelopmentFunctions
			. <<<'PHP'
header( 'X-Robots-Tag: noindex, nofollow' );
$verploy_route = isset( $_GET['rest_route'] ) ? (string) $_GET['rest_route'] : ''; // phpcs:ignore
$verploy_uri   = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : ''; // phpcs:ignore
$verploy_api   = 0 === strpos( $verploy_route, '/verploy/v2/' ) || false !== strpos( $verploy_uri, '/wp-json/verploy/v2/' );
if ( ! $verploy_api && ! ( defined( 'WP_CLI' ) && WP_CLI ) ) {
	$verploy_token = isset( $_SERVER['HTTP_X_VERPLOY_STAGING'] ) ? (string) $_SERVER['HTTP_X_VERPLOY_STAGING'] : ( isset( $_COOKIE['verploy_staging'] ) ? (string) $_COOKIE['verploy_staging'] : '' ); // phpcs:ignore
	if ( ! hash_equals( VERPLOY_STAGING_TOKEN_HASH, hash( 'sha256', $verploy_token ) ) ) {
		status_header( 403 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		echo 'Verploy staging';
		exit;
	}
}
// Staging verstuurt nooit e-mail (bestellingen, formulieren) en wordt niet geïndexeerd.
add_filter( 'pre_wp_mail', '__return_true' );
add_filter( 'pre_option_blog_public', function () { return '0'; } );
// Uploads worden niet gekopieerd: toon ze vanaf productie, schrijf nieuwe naar staging.
add_filter( 'upload_dir', function ( $u ) {
	$u['baseurl'] = VERPLOY_PROD_UPLOADS_URL;
	$u['url']     = VERPLOY_PROD_UPLOADS_URL . $u['subdir'];
	return $u;
} );
PHP;
		wp_mkdir_p( $p['dir'] . '/wp-content/mu-plugins' );
		file_put_contents( $p['dir'] . '/wp-content/mu-plugins/verploy-staging-guard.php', $guard ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		@unlink( $p['dir'] . '/.verploy-manifest' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	}

	// ── Updates uitvoeren (op staging én productie dezelfde code) ─────────────

	/**
	 * Voert één update uit. Idempotent: staat de doelversie er al, dan gebeurt er niets.
	 *
	 * @param array $item ['type' => plugin|theme|core, 'slug' => string, 'to_version' => ?string].
	 * @return array{ok:bool,type:string,slug:string,from_version:?string,to_version:?string,status:string,log:string}
	 */
	public static function apply_update( array $item ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/theme.php';
		require_once ABSPATH . 'wp-admin/includes/update.php';
		require_once ABSPATH . 'wp-admin/includes/misc.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		require_once VERPLOY_PLUGIN_DIR . 'includes/class-quiet-skin.php';
		if ( ! function_exists( 'request_filesystem_credentials' ) || 'direct' !== get_filesystem_method() ) {
			// Zonder directe schrijfrechten kan WordPress niet zelf updaten (FTP-gegevens nodig).
			return self::item_result( $item, false, null, null, 'filesystem_not_writable', '' );
		}
		$type = isset( $item['type'] ) ? $item['type'] : '';
		$slug = isset( $item['slug'] ) ? (string) $item['slug'] : '';
		$to   = isset( $item['to_version'] ) ? (string) $item['to_version'] : null;
		$skin = new Verploy_Quiet_Skin();

		if ( 'plugin' === $type ) {
			wp_clean_plugins_cache( true );
			$plugins = get_plugins();
			if ( ! isset( $plugins[ $slug ] ) ) {
				return self::item_result( $item, false, null, null, 'not_installed', '' );
			}
			$from = $plugins[ $slug ]['Version'];
			if ( $to && version_compare( $from, $to, '>=' ) ) {
				return self::item_result( $item, true, $from, $from, 'already_current', '' );
			}
			wp_update_plugins();
			$updates = get_site_transient( 'update_plugins' );
			if ( ! isset( $updates->response[ $slug ] ) ) {
				return self::item_result( $item, false, $from, null, 'no_update_available', '' );
			}
			$was_active = is_plugin_active( $slug );
			$result     = ( new Plugin_Upgrader( $skin ) )->upgrade( $slug );
			wp_clean_plugins_cache( true );
			$after      = get_plugins();
			$now        = isset( $after[ $slug ] ) ? $after[ $slug ]['Version'] : null;
			if ( $was_active && ! is_plugin_active( $slug ) && null !== $now ) {
				activate_plugin( $slug, '', false, true );
			}
			$ok = ! is_wp_error( $result ) && $result && null !== $now && version_compare( $now, $from, '>' );
			return self::item_result( $item, $ok, $from, $now, $ok ? 'updated' : 'update_failed', $skin->log() . ( is_wp_error( $result ) ? "\n" . $result->get_error_message() : '' ) );
		}

		if ( 'theme' === $type ) {
			$theme = wp_get_theme( $slug );
			if ( ! $theme->exists() ) {
				return self::item_result( $item, false, null, null, 'not_installed', '' );
			}
			$from = $theme->get( 'Version' );
			if ( $to && version_compare( $from, $to, '>=' ) ) {
				return self::item_result( $item, true, $from, $from, 'already_current', '' );
			}
			wp_update_themes();
			$updates = get_site_transient( 'update_themes' );
			if ( ! isset( $updates->response[ $slug ] ) ) {
				return self::item_result( $item, false, $from, null, 'no_update_available', '' );
			}
			$result = ( new Theme_Upgrader( $skin ) )->upgrade( $slug );
			wp_clean_themes_cache();
			$now = wp_get_theme( $slug )->get( 'Version' );
			$ok  = ! is_wp_error( $result ) && $result && version_compare( $now, $from, '>' );
			return self::item_result( $item, $ok, $from, $now, $ok ? 'updated' : 'update_failed', $skin->log() );
		}

		if ( 'core' === $type ) {
			global $wp_version;
			$from = $wp_version;
			if ( $to && version_compare( $from, $to, '>=' ) ) {
				return self::item_result( $item, true, $from, $from, 'already_current', '' );
			}
			wp_version_check( array(), true );
			$update = find_core_update( $to ? $to : '', get_locale() );
			if ( ! $update ) {
				$offers = get_core_updates();
				$update = is_array( $offers ) && ! empty( $offers ) ? $offers[0] : null;
			}
			if ( ! $update || 'upgrade' !== $update->response ) {
				return self::item_result( $item, false, $from, null, 'no_update_available', '' );
			}
			$result = ( new Core_Upgrader( $skin ) )->upgrade( $update );
			$ok     = ! is_wp_error( $result ) && is_string( $result );
			return self::item_result( $item, $ok, $from, $ok ? $result : null, $ok ? 'updated' : 'update_failed', $skin->log() );
		}

		return self::item_result( $item, false, null, null, 'unknown_type', '' );
	}

	private static function item_result( array $item, $ok, $from, $to, $status, $log ) {
		return array(
			'ok'           => (bool) $ok,
			'type'         => isset( $item['type'] ) ? (string) $item['type'] : '',
			'slug'         => isset( $item['slug'] ) ? (string) $item['slug'] : '',
			'from_version' => null === $from ? null : (string) $from,
			'to_version'   => null === $to ? null : (string) $to,
			'status'       => $status,
			'log'          => substr( (string) $log, 0, 20000 ),
		);
	}

	// ── Snapshot en rollback (productie) ─────────────────────────────────────

	private static function item_path( array $item ) {
		if ( 'plugin' === $item['type'] ) {
			$slug = (string) $item['slug'];
			return false === strpos( $slug, '/' ) ? WP_PLUGIN_DIR . '/' . $slug : WP_PLUGIN_DIR . '/' . dirname( $slug );
		}
		if ( 'theme' === $item['type'] ) {
			return get_theme_root( (string) $item['slug'] ) . '/' . $item['slug'];
		}
		return null;
	}

	/**
	 * Maakt vóór de deploy een backup van de betrokken bestanden en álle sitetabellen.
	 * Herhaaldelijk aanroepen tot state = ready.
	 */
	public static function snapshot_create( $run_id, array $items, Verploy_Budget $budget ) {
		global $wpdb;
		self::assert_supported_database();
		$state = self::state( $run_id );
		$short = self::short_id( $run_id );
		$snap  = isset( $state['snapshot'] ) ? $state['snapshot'] : array( 'phase' => 'init' );

		if ( 'init' === $snap['phase'] ) {
			$base = Verploy_File_Copier::norm( WP_CONTENT_DIR ) . '/verploy-backups';
			self::protect_dir( $base );
			file_put_contents( $base . '/.htaccess', "Require all denied\nDeny from all\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
			$dir = $base . '/' . $short . '-' . wp_generate_password( 16, false, false );
			wp_mkdir_p( $dir );
			$files = array();
			foreach ( $items as $item ) {
				if ( 'core' === $item['type'] ) {
					$abs = Verploy_File_Copier::norm( ABSPATH );
					foreach ( array( 'wp-admin', 'wp-includes' ) as $d ) {
						$files[] = array( 'live' => $abs . '/' . $d, 'backup' => $dir . '/core/' . $d );
					}
					foreach ( (array) glob( $abs . '/*.php' ) as $f ) {
						if ( 'wp-config.php' !== basename( $f ) ) {
							$files[] = array( 'live' => $f, 'backup' => $dir . '/core/' . basename( $f ) );
						}
					}
					continue;
				}
				$path = self::item_path( $item );
				if ( $path && file_exists( $path ) ) {
					$files[] = array( 'live' => Verploy_File_Copier::norm( $path ), 'backup' => $dir . '/items/' . md5( $path ) );
				}
			}
			$snap = array(
				'phase'  => 'files',
				'dir'    => $dir,
				'files'  => $files,
				'fi'     => 0,
				'prefix' => 'vpbk' . $short . '_',
				'live_tables' => Verploy_Table_Copier::tables_with_prefix( $wpdb->prefix ),
				'tables' => array(),
				'created'=> time(),
			);
			$state['snapshot'] = $snap;
			self::save_state( $state );
			self::install_rescue();
		}

		if ( 'files' === $snap['phase'] ) {
			while ( $snap['fi'] < count( $snap['files'] ) && ! $budget->expired() ) {
				$f = $snap['files'][ $snap['fi'] ];
				if ( ! Verploy_File_Copier::copy_tree( $f['live'], $f['backup'] ) ) {
					throw new RuntimeException( 'backup_copy_failed:' . $f['live'] );
				}
				$snap['fi']++;
			}
			if ( $snap['fi'] >= count( $snap['files'] ) ) {
				$snap['phase'] = 'tables';
			}
			$state['snapshot'] = $snap;
			self::save_state( $state );
		}

		if ( 'tables' === $snap['phase'] && ! $budget->expired() ) {
			$ts = $snap['tables'];
			if ( Verploy_Table_Copier::copy_step( $wpdb->prefix, $snap['prefix'], $ts, $budget ) ) {
				$snap['phase'] = 'ready';
			}
			$snap['tables']    = $ts;
			$state['snapshot'] = $snap;
			self::save_state( $state );
		}

		return array( 'state' => 'ready' === $snap['phase'] ? 'ready' : 'building', 'phase' => $snap['phase'] );
	}

	/**
	 * Zet bestanden en database terug naar de snapshot. Idempotent.
	 */
	public static function rollback( $run_id ) {
		global $wpdb;
		$state = self::state( $run_id );
		if ( empty( $state['snapshot'] ) || 'ready' !== $state['snapshot']['phase'] ) {
			throw new RuntimeException( 'no_snapshot' );
		}
		$snap = $state['snapshot'];
		if ( empty( $snap['files_restored'] ) ) {
			foreach ( $snap['files'] as $f ) {
				if ( ! file_exists( $f['backup'] ) ) {
					continue;
				}
				if ( is_dir( $f['live'] ) ) {
					Verploy_File_Copier::delete_tree( $f['live'] );
				} elseif ( is_file( $f['live'] ) ) {
					@unlink( $f['live'] ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
				}
				if ( ! Verploy_File_Copier::copy_tree( $f['backup'], $f['live'] ) ) {
					throw new RuntimeException( 'restore_copy_failed:' . $f['live'] );
				}
			}
			$snap['files_restored'] = true;
			$state['snapshot']      = $snap;
			self::save_state( $state );
		}
		if ( empty( $snap['tables_restored'] ) ) {
			Verploy_Table_Copier::restore( $wpdb->prefix, $snap['prefix'], $snap['live_tables'] );
			// De teruggezette options-tabel bevat de run-state van vóór de snapshot: opnieuw vastleggen.
			$snap['tables_restored'] = true;
			$state['snapshot']       = $snap;
			self::save_state( $state );
		}
		wp_cache_flush();
		if ( function_exists( 'opcache_reset' ) ) {
			@opcache_reset(); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
		return array( 'state' => 'rolled_back' );
	}

	// ── Noodroute voor rollback ─────────────────────────────────────────────

	public static function rescue_path() {
		return ( defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins' ) . '/verploy-rescue.php';
	}

	/**
	 * Installeert tijdens een deploy een must-use-plugin die ondertekende rollback-verzoeken
	 * afhandelt vóórdat gewone plugins laden. Zo werkt terugdraaien ook als een update
	 * een fatale fout geeft die de hele site (inclusief de REST-API) onderuit haalt.
	 */
	public static function install_rescue() {
		$dir = dirname( self::rescue_path() );
		wp_mkdir_p( $dir );
		$includes = var_export( Verploy_File_Copier::norm( __DIR__ ), true ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions
		$code     = "<?php\n// Verploy rollback-noodroute (automatisch aangemaakt tijdens een deploy en daarna verwijderd).\nif ( ! defined( 'ABSPATH' ) ) { exit; }\n"
			. '$verploy_includes = ' . $includes . ";\n"
			. <<<'PHP'
$verploy_route  = isset( $_GET['rest_route'] ) ? (string) $_GET['rest_route'] : ''; // phpcs:ignore
$verploy_uri    = isset( $_SERVER['REQUEST_URI'] ) ? (string) strtok( (string) $_SERVER['REQUEST_URI'], '?' ) : ''; // phpcs:ignore
$verploy_prefix = '/' . trim( function_exists( 'rest_get_url_prefix' ) ? rest_get_url_prefix() : 'wp-json', '/' ) . '/verploy/v2/rollback';
if ( 'POST' === ( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : '' ) // phpcs:ignore
	&& ( '/verploy/v2/rollback' === $verploy_route || substr( $verploy_uri, -strlen( $verploy_prefix ) ) === $verploy_prefix )
	&& is_file( $verploy_includes . '/class-run-engine.php' ) ) {
	foreach ( array( 'class-signer', 'class-connection', 'class-heartbeat', 'class-file-copier', 'class-table-copier', 'class-run-lock', 'class-run-engine' ) as $verploy_f ) {
		require_once $verploy_includes . '/' . $verploy_f . '.php';
	}
	$verploy_body    = (string) file_get_contents( 'php://input' );
	$verploy_headers = array();
	foreach ( array( 'x-verploy-site', 'x-verploy-timestamp', 'x-verploy-nonce', 'x-verploy-signature' ) as $verploy_h ) {
		$verploy_key                   = 'HTTP_' . strtoupper( str_replace( '-', '_', $verploy_h ) );
		$verploy_headers[ $verploy_h ] = isset( $_SERVER[ $verploy_key ] ) ? (string) $_SERVER[ $verploy_key ] : ''; // phpcs:ignore
	}
	$verploy_ok   = Verploy_Connection::is_connected()
		&& true === Verploy_Signer::verify( Verploy_Connection::site_id(), Verploy_Connection::secret(), $verploy_headers, 'POST', '/verploy/v2/rollback', $verploy_body );
	$verploy_data = json_decode( $verploy_body, true );
	$verploy_run  = is_array( $verploy_data ) && isset( $verploy_data['run_id'] ) ? (string) $verploy_data['run_id'] : '';
	header( 'Content-Type: application/json; charset=utf-8' );
	header( 'X-Verploy-Rescue: 1' );
	if ( ! $verploy_ok ) {
		http_response_code( 401 );
		echo '{"code":"verploy_unauthorized"}';
		exit;
	}
	if ( ! Verploy_Run_Engine::valid_run_id( $verploy_run ) || ! Verploy_Run_Lock::holds( $verploy_run ) ) {
		http_response_code( 409 );
		echo '{"code":"verploy_not_locked"}';
		exit;
	}
	try {
		$verploy_result = Verploy_Run_Engine::rollback( $verploy_run );
		http_response_code( 200 );
		echo wp_json_encode( $verploy_result );
	} catch ( Throwable $verploy_e ) {
		http_response_code( 500 );
		echo wp_json_encode( array( 'code' => 'verploy_run_failed', 'message' => $verploy_e->getMessage() ) );
	}
	exit;
}
PHP;
		if ( false === file_put_contents( self::rescue_path(), $code ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
			throw new RuntimeException( 'rescue_install_failed' );
		}
	}

	public static function remove_rescue() {
		if ( is_file( self::rescue_path() ) ) {
			@unlink( self::rescue_path() ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
	}

	// ── Onderhoudsmodus (productie, tijdens deploy + post-check) ─────────────

	public static function set_maintenance( $run_id, $enabled, $ttl ) {
		if ( $enabled ) {
			update_option( self::MAINTENANCE_OPTION, array( 'run_id' => $run_id, 'until' => time() + max( 60, min( 1800, (int) $ttl ) ), 'bypass' => hash( 'sha256', self::bypass_token( $run_id ) ) ), true );
		} else {
			$m = get_option( self::MAINTENANCE_OPTION );
			if ( is_array( $m ) && $m['run_id'] === $run_id ) {
				delete_option( self::MAINTENANCE_OPTION );
			}
		}
		return array( 'maintenance' => (bool) $enabled );
	}

	/** Toont bezoekers een 503 tijdens de deploy; de worker test met een bypass-token. */
	public static function maybe_block_request() {
		$m = get_option( self::MAINTENANCE_OPTION );
		if ( ! is_array( $m ) || $m['until'] < time() || is_admin() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : ''; // phpcs:ignore
		if ( false !== strpos( $uri, 'wp-login.php' ) || false !== strpos( $uri, '/wp-json/' ) || isset( $_GET['rest_route'] ) ) { // phpcs:ignore
			return;
		}
		$given = isset( $_SERVER['HTTP_X_VERPLOY_BYPASS'] ) ? (string) $_SERVER['HTTP_X_VERPLOY_BYPASS'] : ( isset( $_COOKIE['verploy_bypass'] ) ? (string) $_COOKIE['verploy_bypass'] : '' ); // phpcs:ignore
		if ( '' !== $given && hash_equals( $m['bypass'], hash( 'sha256', $given ) ) ) {
			return;
		}
		header( 'Retry-After: 120' );
		wp_die(
			esc_html__( 'Briefly unavailable for scheduled maintenance. Check back in a minute.' ), // phpcs:ignore WordPress.WP.I18n.MissingArgDomain -- WordPress-kerntekst, automatisch vertaald
			esc_html__( 'Maintenance' ), // phpcs:ignore WordPress.WP.I18n.MissingArgDomain
			array( 'response' => 503 )
		);
	}

	// ── Opruimen ─────────────────────────────────────────────────────────────

	/**
	 * Verwijdert staging (bestanden + tabellen), zet onderhoudsmodus uit en geeft de lock vrij.
	 * Backups blijven 7 dagen bewaard; oudere backups worden hier ook opgeruimd.
	 */
	public static function cleanup( $run_id ) {
		global $wpdb;
		$p = self::staging_paths( $run_id );
		Verploy_File_Copier::delete_tree( $p['dir'] );
		Verploy_Table_Copier::drop_prefix( $p['prefix'] );
		self::set_maintenance( $run_id, false, 0 );
		self::remove_rescue();
		Verploy_Run_Lock::release( $run_id );
		self::purge_old_backups( 7 * DAY_IN_SECONDS );
		$state = get_option( self::STATE_OPTION );
		if ( is_array( $state ) && $state['run_id'] === $run_id ) {
			$keep = array( 'run_id' => $run_id, 'cleaned' => time() );
			if ( isset( $state['snapshot'] ) ) {
				$keep['snapshot'] = $state['snapshot'];
			}
			self::save_state( $keep );
		}
		$wpdb->flush();
		return array( 'state' => 'cleaned' );
	}

	public static function purge_old_backups( $max_age ) {
		$base = Verploy_File_Copier::norm( WP_CONTENT_DIR ) . '/verploy-backups';
		foreach ( (array) glob( $base . '/*', GLOB_ONLYDIR ) as $dir ) {
			if ( filemtime( $dir ) < time() - $max_age ) {
				$short = substr( basename( $dir ), 0, 8 );
				Verploy_File_Copier::delete_tree( $dir );
				Verploy_Table_Copier::drop_prefix( 'vpbk' . $short . '_' );
			}
		}
	}

	// ── Testpagina's ─────────────────────────────────────────────────────────

	const MAX_PAGES = 8;

	/**
	 * Bepaalt welke pagina's de worker test. Zonder $keys (productie): startpagina, menu-items,
	 * webwinkelpagina's en de opgegeven extra paden. Met $keys (staging): dezelfde objecten,
	 * maar met de URL's van deze installatie (staging gebruikt eenvoudige permalinks).
	 *
	 * @param string[]|null $keys        Sleutels uit een eerdere productie-aanroep.
	 * @param string[]      $extra_paths Extra paden (alleen productie), bijv. /contact/.
	 * @return array<int,array{key:string,label:string,url:string}>
	 */
	public static function pages( $keys, array $extra_paths ) {
		$out  = array();
		$seen = array();
		$add  = function ( $key, $label, $url ) use ( &$out, &$seen ) {
			if ( ! $url || isset( $seen[ $key ] ) || count( $out ) >= self::MAX_PAGES ) {
				return;
			}
			$seen[ $key ] = true;
			$out[]        = array( 'key' => $key, 'label' => wp_strip_all_tags( (string) $label ), 'url' => (string) $url );
		};
		$resolve = function ( $key ) {
			if ( 'home' === $key ) {
				return array( get_bloginfo( 'name' ), home_url( '/' ) );
			}
			if ( preg_match( '/^post:(\d+)$/', $key, $m ) ) {
				$post = get_post( (int) $m[1] );
				return $post && 'publish' === $post->post_status ? array( get_the_title( $post ), get_permalink( $post ) ) : null;
			}
			if ( preg_match( '/^term:(\d+)$/', $key, $m ) ) {
				$term = get_term( (int) $m[1] );
				$link = $term && ! is_wp_error( $term ) ? get_term_link( $term ) : null;
				return $link && ! is_wp_error( $link ) ? array( $term->name, $link ) : null;
			}
			return null;
		};

		if ( is_array( $keys ) ) {
			foreach ( $keys as $key ) {
				$r = $resolve( (string) $key );
				if ( $r ) {
					$add( (string) $key, $r[0], $r[1] );
				}
			}
			return $out;
		}

		$r = $resolve( 'home' );
		$add( 'home', $r[0], $r[1] );
		$host = wp_parse_url( home_url(), PHP_URL_HOST );
		foreach ( $extra_paths as $path ) {
			$path = '/' . ltrim( (string) $path, '/' );
			$url  = home_url( $path );
			$id   = url_to_postid( $url );
			if ( $id ) {
				$r = $resolve( 'post:' . $id );
				if ( $r ) {
					$add( 'post:' . $id, $r[0], $r[1] );
				}
				continue;
			}
			$add( 'path:' . $path, $path, $url );
		}
		foreach ( get_nav_menu_locations() as $menu_id ) {
			foreach ( (array) wp_get_nav_menu_items( $menu_id ) as $item ) {
				if ( ! is_object( $item ) ) {
					continue;
				}
				if ( 'post_type' === $item->type ) {
					$r = $resolve( 'post:' . (int) $item->object_id );
					if ( $r ) {
						$add( 'post:' . (int) $item->object_id, $item->title, $r[1] );
					}
				} elseif ( 'taxonomy' === $item->type ) {
					$r = $resolve( 'term:' . (int) $item->object_id );
					if ( $r ) {
						$add( 'term:' . (int) $item->object_id, $item->title, $r[1] );
					}
				} elseif ( 'custom' === $item->type && wp_parse_url( $item->url, PHP_URL_HOST ) === $host ) {
					$id = url_to_postid( $item->url );
					if ( $id ) {
						$add( 'post:' . $id, $item->title, get_permalink( $id ) );
					}
				}
			}
		}
		// Blokthema's: navigatie staat in wp_navigation-berichten in plaats van menulocaties.
		$nav_posts = get_posts( array( 'post_type' => 'wp_navigation', 'numberposts' => 3, 'post_status' => 'publish' ) );
		$walk      = function ( array $blocks ) use ( &$walk, $add, $resolve, $host ) {
			foreach ( $blocks as $block ) {
				$name  = isset( $block['blockName'] ) ? $block['blockName'] : '';
				$attrs = isset( $block['attrs'] ) ? $block['attrs'] : array();
				if ( in_array( $name, array( 'core/navigation-link', 'core/navigation-submenu' ), true ) ) {
					$kind = isset( $attrs['kind'] ) ? $attrs['kind'] : 'custom';
					$id   = isset( $attrs['id'] ) ? (int) $attrs['id'] : 0;
					$key  = null;
					if ( 'post-type' === $kind && $id ) {
						$key = 'post:' . $id;
					} elseif ( 'taxonomy' === $kind && $id ) {
						$key = 'term:' . $id;
					} elseif ( ! empty( $attrs['url'] ) && wp_parse_url( $attrs['url'], PHP_URL_HOST ) === $host ) {
						$pid = url_to_postid( $attrs['url'] );
						$key = $pid ? 'post:' . $pid : null;
					}
					$r = $key ? $resolve( $key ) : null;
					if ( $r ) {
						$add( $key, isset( $attrs['label'] ) ? $attrs['label'] : $r[0], $r[1] );
					}
				} elseif ( 'core/page-list' === $name ) {
					foreach ( get_pages( array( 'parent' => 0, 'sort_column' => 'menu_order', 'number' => self::MAX_PAGES ) ) as $page ) {
						$add( 'post:' . $page->ID, get_the_title( $page ), get_permalink( $page ) );
					}
				}
				if ( ! empty( $block['innerBlocks'] ) ) {
					$walk( $block['innerBlocks'] );
				}
			}
		};
		foreach ( $nav_posts as $nav ) {
			$walk( parse_blocks( $nav->post_content ) );
		}
		// WooCommerce: winkel, winkelwagen en afrekenen zijn de pagina's die het meest stukgaan.
		if ( function_exists( 'wc_get_page_id' ) ) {
			foreach ( array( 'shop', 'cart', 'checkout' ) as $wc ) {
				$id = (int) wc_get_page_id( $wc );
				if ( $id > 0 ) {
					$r = $resolve( 'post:' . $id );
					if ( $r ) {
						$add( 'post:' . $id, $r[0], $r[1] );
					}
				}
			}
		}
		// Geen menu? Neem de nieuwste pagina's en het nieuwste bericht.
		if ( count( $out ) < 3 ) {
			foreach ( get_posts( array( 'post_type' => array( 'page', 'post' ), 'numberposts' => 4, 'post_status' => 'publish' ) ) as $post ) {
				$add( 'post:' . $post->ID, get_the_title( $post ), get_permalink( $post ) );
			}
		}
		return $out;
	}

	public static function describe( $run_id ) {
		$state = self::state( $run_id );
		unset( $state['staging']['tables'], $state['snapshot']['tables'], $state['snapshot']['live_tables'] );
		return array(
			'lock'        => get_option( Verploy_Run_Lock::OPTION ),
			'maintenance' => (bool) get_option( self::MAINTENANCE_OPTION ),
			'state'       => $state,
			'staging'     => defined( 'VERPLOY_STAGING' ) && VERPLOY_STAGING,
		);
	}
}
