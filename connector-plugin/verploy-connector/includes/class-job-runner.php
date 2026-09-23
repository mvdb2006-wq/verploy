<?php
/**
 * Executes pending update jobs received from the Verploy cloud.
 *
 * Called by Verploy_Heartbeat after a successful heartbeat response.
 * Each job is executed immediately and the result is reported back.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Verploy_Job_Runner {

	/**
	 * Process an array of pending jobs from the heartbeat response.
	 *
	 * @param array  $jobs    Array of job objects from the API response.
	 * @param string $api_key Site API key for reporting back.
	 */
	public static function run( array $jobs, string $api_key ): void {
		if ( empty( $jobs ) ) return;

		// Make sure WordPress upgrade infrastructure is loaded
		self::load_upgrade_libs();

		$client = new Verploy_API_Client( $api_key );

		foreach ( $jobs as $job ) {
			$id   = $job['id']   ?? null;
			$type = $job['type'] ?? null;
			$slug = $job['slug'] ?? null;
			$name = $job['name'] ?? $slug;
			$to   = $job['to_version'] ?? null;

			if ( ! $id || ! $type || ! $slug ) {
				continue;
			}

			$result = self::execute( $type, $slug, $name, $to );

			// Report back to Verploy — always, even on failure
			$client->post( "/sites/jobs/{$id}/complete", [
				'success'     => $result['success'],
				'log'         => $result['log'],
				'from_version' => $result['from_version'] ?? null,
				'to_version'   => $result['to_version']   ?? null,
			] );
		}
	}

	// ─── Execution ───────────────────────────────────────────────────────────────

	/**
	 * Execute a single update job.
	 *
	 * @param string      $type 'plugin', 'theme', or 'core'
	 * @param string      $slug Plugin file (e.g. "woocommerce/woocommerce.php") or theme slug
	 * @param string|null $name Human-readable name for logging
	 * @param string|null $to_version Target version (informational; WP picks the latest)
	 * @return array{ success: bool, log: string, from_version: ?string, to_version: ?string }
	 */
	private static function execute( string $type, string $slug, ?string $name, ?string $to_version ): array {
		$from_version = null;
		$to_actual    = null;

		ob_start(); // capture any stray output from upgrader

		try {
			switch ( $type ) {
				case 'plugin':
					return self::update_plugin( $slug, $name, $to_version );

				case 'theme':
					return self::update_theme( $slug, $name, $to_version );

				case 'core':
					return self::update_core();

				default:
					ob_end_clean();
					return [
						'success'      => false,
						'log'          => "Onbekend job-type: {$type}",
						'from_version' => null,
						'to_version'   => null,
					];
			}
		} catch ( Throwable $e ) {
			ob_end_clean();
			return [
				'success'      => false,
				'log'          => 'Onverwachte fout: ' . $e->getMessage(),
				'from_version' => null,
				'to_version'   => null,
			];
		}
	}

	// ─── Plugin update ───────────────────────────────────────────────────────────

	private static function update_plugin( string $slug, ?string $name, ?string $to_version ): array {
		// Capture current version before update
		$all_plugins  = get_plugins();
		$from_version = $all_plugins[ $slug ]['Version'] ?? null;

		// Fetch available updates
		$update_data = self::get_plugin_update( $slug );

		if ( ! $update_data ) {
			ob_end_clean();
			return [
				'success'      => false,
				'log'          => "Geen update beschikbaar voor {$slug}. Mogelijk al up-to-date.",
				'from_version' => $from_version,
				'to_version'   => $to_version,
			];
		}

		$skin      = new Verploy_Silent_Upgrader_Skin();
		$upgrader  = new Plugin_Upgrader( $skin );
		$result    = $upgrader->upgrade( $slug );
		$log       = $skin->get_log();

		ob_end_clean();

		if ( is_wp_error( $result ) ) {
			return [
				'success'      => false,
				'log'          => $result->get_error_message() . "\n" . $log,
				'from_version' => $from_version,
				'to_version'   => $to_version,
			];
		}

		if ( $result === false ) {
			return [
				'success'      => false,
				'log'          => "Update mislukt (onbekende fout).\n" . $log,
				'from_version' => $from_version,
				'to_version'   => $to_version,
			];
		}

		// Read new version after update
		$plugins_after = get_plugins();
		$to_actual     = $plugins_after[ $slug ]['Version'] ?? $to_version;

		return [
			'success'      => true,
			'log'          => "Plugin '{$name}' bijgewerkt van {$from_version} naar {$to_actual}.\n" . $log,
			'from_version' => $from_version,
			'to_version'   => $to_actual,
		];
	}

	// ─── Theme update ────────────────────────────────────────────────────────────

	private static function update_theme( string $slug, ?string $name, ?string $to_version ): array {
		$theme        = wp_get_theme( $slug );
		$from_version = $theme->get( 'Version' ) ?: null;

		$update_data = self::get_theme_update( $slug );

		if ( ! $update_data ) {
			ob_end_clean();
			return [
				'success'      => false,
				'log'          => "Geen update beschikbaar voor thema {$slug}.",
				'from_version' => $from_version,
				'to_version'   => $to_version,
			];
		}

		$skin     = new Verploy_Silent_Upgrader_Skin();
		$upgrader = new Theme_Upgrader( $skin );
		$result   = $upgrader->upgrade( $slug );
		$log      = $skin->get_log();

		ob_end_clean();

		if ( is_wp_error( $result ) || $result === false ) {
			$error = is_wp_error( $result ) ? $result->get_error_message() : 'Onbekende fout';
			return [
				'success'      => false,
				'log'          => "Thema-update mislukt: {$error}\n" . $log,
				'from_version' => $from_version,
				'to_version'   => $to_version,
			];
		}

		$theme_after = wp_get_theme( $slug );
		$to_actual   = $theme_after->get( 'Version' ) ?: $to_version;

		return [
			'success'      => true,
			'log'          => "Thema '{$name}' bijgewerkt van {$from_version} naar {$to_actual}.\n" . $log,
			'from_version' => $from_version,
			'to_version'   => $to_actual,
		];
	}

	// ─── Core update ─────────────────────────────────────────────────────────────

	private static function update_core(): array {
		global $wp_version;
		$from_version = $wp_version;

		require_once ABSPATH . 'wp-admin/includes/update.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

		$skin     = new Verploy_Silent_Upgrader_Skin();
		$upgrader = new Core_Upgrader( $skin );
		$updates  = get_core_updates();

		if ( empty( $updates ) || $updates[0]->response === 'latest' ) {
			ob_end_clean();
			return [
				'success'      => false,
				'log'          => 'WordPress is al up-to-date.',
				'from_version' => $from_version,
				'to_version'   => null,
			];
		}

		$update = $updates[0];
		$result = $upgrader->upgrade( $update );
		$log    = $skin->get_log();

		ob_end_clean();

		if ( is_wp_error( $result ) || $result === false ) {
			$error = is_wp_error( $result ) ? $result->get_error_message() : 'Onbekende fout';
			return [
				'success'      => false,
				'log'          => "WordPress-core update mislukt: {$error}\n" . $log,
				'from_version' => $from_version,
				'to_version'   => $update->current ?? null,
			];
		}

		return [
			'success'      => true,
			'log'          => "WordPress bijgewerkt van {$from_version} naar {$update->current}.\n" . $log,
			'from_version' => $from_version,
			'to_version'   => $update->current,
		];
	}

	// ─── Update-info helpers ─────────────────────────────────────────────────────

	/**
	 * Get the update object for a plugin, or null if no update is available.
	 */
	private static function get_plugin_update( string $slug ): ?object {
		// Refresh transient so we have fresh data
		wp_update_plugins();
		$update_transient = get_site_transient( 'update_plugins' );
		return $update_transient->response[ $slug ] ?? null;
	}

	/**
	 * Get the update object for a theme, or null if no update is available.
	 */
	private static function get_theme_update( string $slug ): ?object {
		wp_update_themes();
		$update_transient = get_site_transient( 'update_themes' );
		$data = $update_transient->response[ $slug ] ?? null;
		return $data ? (object) $data : null;
	}

	// ─── Bootstrap ───────────────────────────────────────────────────────────────

	/**
	 * Load all WordPress upgrader infrastructure needed for updates.
	 * These files are not loaded by default on the front-end.
	 */
	private static function load_upgrade_libs(): void {
		if ( ! function_exists( 'request_filesystem_credentials' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		if ( ! class_exists( 'WP_Upgrader' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		}
		if ( ! class_exists( 'Plugin_Upgrader' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-plugin-upgrader.php';
		}
		if ( ! class_exists( 'Theme_Upgrader' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-theme-upgrader.php';
		}
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		// Tell WordPress to use direct filesystem — avoids FTP credential prompts
		add_filter( 'filesystem_method', function() { return 'direct'; } );
	}
}

// ─── Silent upgrader skin ─────────────────────────────────────────────────────

/**
 * Upgrader skin that captures output instead of printing it.
 * Used by Verploy_Job_Runner so update logs can be stored and reported.
 */
class Verploy_Silent_Upgrader_Skin extends WP_Upgrader_Skin {

	private array $messages = [];

	public function feedback( $string, ...$args ): void {
		if ( ! empty( $string ) ) {
			$this->messages[] = is_string( $string ) ? $string : (string) $string;
		}
	}

	public function header(): void {}
	public function footer(): void {}
	public function error( $errors ): void {
		if ( is_wp_error( $errors ) ) {
			foreach ( $errors->get_error_messages() as $msg ) {
				$this->messages[] = 'Fout: ' . $msg;
			}
		} else {
			$this->messages[] = 'Fout: ' . (string) $errors;
		}
	}

	public function get_log(): string {
		return implode( "\n", $this->messages );
	}
}
