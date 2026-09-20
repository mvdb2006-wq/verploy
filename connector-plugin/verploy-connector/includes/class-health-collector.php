<?php
/**
 * Collects site health data: server info, plugins, themes, WordPress core.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Verploy_Health_Collector {

	/**
	 * Build the full health payload sent to Verploy's API.
	 */
	public static function collect(): array {
		return [
			'collected_at' => gmdate( 'c' ),
			'site'         => self::site_info(),
			'server'       => self::server_info(),
			'wordpress'    => self::wordpress_info(),
			'plugins'      => self::plugins_info(),
			'themes'       => self::themes_info(),
			'performance'  => self::performance_info(),
		];
	}

	// ── Site ─────────────────────────────────────────────────────────────────

	private static function site_info(): array {
		return [
			'url'       => get_site_url(),
			'name'      => get_bloginfo( 'name' ),
			'admin_email' => get_option( 'admin_email' ),
			'language'  => get_locale(),
			'timezone'  => wp_timezone_string(),
			'multisite' => is_multisite(),
		];
	}

	// ── Server ───────────────────────────────────────────────────────────────

	private static function server_info(): array {
		global $wpdb;

		// OPcache
		$opcache = [];
		if ( function_exists( 'opcache_get_status' ) ) {
			$status  = opcache_get_status( false );
			$opcache = [
				'enabled'         => (bool) ( $status['opcache_enabled'] ?? false ),
				'memory_used_mb'  => isset( $status['memory_usage']['used_memory'] )
					? round( $status['memory_usage']['used_memory'] / 1024 / 1024, 1 )
					: null,
				'hit_rate'        => isset( $status['opcache_statistics']['opcache_hit_rate'] )
					? round( $status['opcache_statistics']['opcache_hit_rate'], 2 )
					: null,
			];
		}

		// MySQL version
		$mysql_version = $wpdb->get_var( 'SELECT VERSION()' );

		return [
			'php_version'       => PHP_VERSION,
			'php_major'         => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
			'mysql_version'     => $mysql_version,
			'web_server'        => $_SERVER['SERVER_SOFTWARE'] ?? 'unknown',
			'memory_limit'      => ini_get( 'memory_limit' ),
			'max_execution_time'=> (int) ini_get( 'max_execution_time' ),
			'upload_max_size'   => ini_get( 'upload_max_filesize' ),
			'post_max_size'     => ini_get( 'post_max_size' ),
			'max_input_vars'    => (int) ini_get( 'max_input_vars' ),
			'curl_enabled'      => function_exists( 'curl_version' ),
			'openssl_version'   => defined( 'OPENSSL_VERSION_TEXT' ) ? OPENSSL_VERSION_TEXT : null,
			'opcache'           => $opcache,
			'os'                => PHP_OS,
		];
	}

	// ── WordPress ────────────────────────────────────────────────────────────

	private static function wordpress_info(): array {
		global $wp_version;

		// Check for core updates
		$update_core = get_site_transient( 'update_core' );
		$core_update = null;
		if ( isset( $update_core->updates ) ) {
			foreach ( $update_core->updates as $update ) {
				if ( 'upgrade' === $update->response ) {
					$core_update = $update->current;
					break;
				}
			}
		}

		// SSL
		$ssl_info = self::ssl_info();

		return [
			'version'             => $wp_version,
			'core_update_available' => $core_update,
			'is_latest_core'      => is_null( $core_update ),
			'debug_mode'          => defined( 'WP_DEBUG' ) && WP_DEBUG,
			'debug_log'           => defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG,
			'automatic_updates'   => (bool) get_option( 'auto_update_core_minor' ),
			'permalink_structure' => get_option( 'permalink_structure' ),
			'active_theme'        => wp_get_theme()->get( 'Name' ),
			'ssl'                 => $ssl_info,
		];
	}

	private static function ssl_info(): array {
		$url          = get_site_url();
		$is_https     = str_starts_with( $url, 'https://' );
		$expires_days = null;
		$issuer       = null;
		$valid_from   = null;

		if ( $is_https ) {
			$host = wp_parse_url( $url, PHP_URL_HOST );
			$ctx  = @stream_context_create( [ 'ssl' => [ 'capture_peer_cert' => true ] ] );
			$fp   = @stream_socket_client(
				"ssl://{$host}:443",
				$errno,
				$errstr,
				10,
				STREAM_CLIENT_CONNECT,
				$ctx
			);
			if ( $fp ) {
				$params = stream_context_get_params( $fp );
				$cert   = openssl_x509_parse( $params['options']['ssl']['peer_certificate'] );
				fclose( $fp );

				if ( $cert ) {
					$expires_ts   = $cert['validTo_time_t'];
					$expires_days = (int) ( ( $expires_ts - time() ) / DAY_IN_SECONDS );
					$valid_from   = gmdate( 'c', $cert['validFrom_time_t'] );
					$issuer       = $cert['issuer']['O'] ?? null;
				}
			}
		}

		return [
			'enabled'      => $is_https,
			'expires_days' => $expires_days,
			'valid_from'   => $valid_from,
			'issuer'       => $issuer,
		];
	}

	// ── Plugins ──────────────────────────────────────────────────────────────

	private static function plugins_info(): array {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		if ( ! function_exists( 'get_plugin_updates' ) ) {
			require_once ABSPATH . 'wp-admin/includes/update.php';
		}

		$all_plugins    = get_plugins();
		$active_plugins = get_option( 'active_plugins', [] );
		$updates        = get_plugin_updates();
		$result         = [];

		foreach ( $all_plugins as $file => $data ) {
			$has_update     = isset( $updates[ $file ] );
			$update_version = $has_update ? $updates[ $file ]->update->new_version : null;

			$result[] = [
				'file'           => $file,
				'name'           => $data['Name'],
				'version'        => $data['Version'],
				'author'         => $data['Author'],
				'active'         => in_array( $file, $active_plugins, true ),
				'update_available' => $has_update,
				'update_version' => $update_version,
				'auto_update'    => (bool) is_plugin_active_for_network( $file ),
			];
		}

		return $result;
	}

	// ── Themes ───────────────────────────────────────────────────────────────

	private static function themes_info(): array {
		$all_themes    = wp_get_themes();
		$active_theme  = get_stylesheet();
		$updates       = get_theme_updates();
		$result        = [];

		foreach ( $all_themes as $slug => $theme ) {
			$has_update     = isset( $updates[ $slug ] );
			$update_version = $has_update ? $updates[ $slug ]->update['new_version'] : null;

			$result[] = [
				'slug'             => $slug,
				'name'             => $theme->get( 'Name' ),
				'version'          => $theme->get( 'Version' ),
				'author'           => $theme->get( 'Author' ),
				'active'           => ( $slug === $active_theme ),
				'update_available' => $has_update,
				'update_version'   => $update_version,
			];
		}

		return $result;
	}

	// ── Performance ──────────────────────────────────────────────────────────

	private static function performance_info(): array {
		// Measure DB query time
		global $wpdb;
		$start      = microtime( true );
		$wpdb->get_var( 'SELECT 1' );
		$db_time_ms = round( ( microtime( true ) - $start ) * 1000, 2 );

		// Disk usage (uploads directory)
		$upload_dir  = wp_upload_dir();
		$upload_size = 0;
		if ( is_dir( $upload_dir['basedir'] ) ) {
			$upload_size = self::dir_size( $upload_dir['basedir'] );
		}

		return [
			'db_response_ms'    => $db_time_ms,
			'uploads_size_mb'   => round( $upload_size / 1024 / 1024, 1 ),
			'active_plugins_count' => count( get_option( 'active_plugins', [] ) ),
		];
	}

	private static function dir_size( string $dir ): int {
		$size = 0;
		foreach ( new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ) ) as $file ) {
			$size += $file->getSize();
		}
		return $size;
	}
}
