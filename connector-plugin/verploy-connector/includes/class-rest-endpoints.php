<?php
/**
 * REST API endpoints that Verploy's cloud can call inbound on the WordPress site.
 * All endpoints require a valid Verploy API key in the Authorization header.
 *
 * Endpoints:
 *   GET  /wp-json/verploy/v1/health        — Full health snapshot
 *   POST /wp-json/verploy/v1/update        — Trigger a plugin/theme/core update
 *   GET  /wp-json/verploy/v1/status        — Quick liveness check
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Verploy_REST_Endpoints {

	public static function init(): void {
		add_action( 'rest_api_init', [ __CLASS__, 'register_routes' ] );
	}

	public static function register_routes(): void {
		$namespace = 'verploy/v1';

		register_rest_route( $namespace, '/status', [
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => [ __CLASS__, 'status' ],
			'permission_callback' => [ __CLASS__, 'authenticate' ],
		] );

		register_rest_route( $namespace, '/health', [
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => [ __CLASS__, 'health' ],
			'permission_callback' => [ __CLASS__, 'authenticate' ],
		] );

		register_rest_route( $namespace, '/update', [
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => [ __CLASS__, 'trigger_update' ],
			'permission_callback' => [ __CLASS__, 'authenticate' ],
			'args'                => [
				'type' => [
					'required'          => true,
					'type'              => 'string',
					'enum'              => [ 'plugin', 'theme', 'core' ],
					'sanitize_callback' => 'sanitize_text_field',
				],
				'slug' => [
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				],
			],
		] );
	}

	// ── Authentication ────────────────────────────────────────────────────────

	public static function authenticate( WP_REST_Request $request ): bool|WP_Error {
		$stored_key = get_option( 'verploy_api_key' );
		if ( ! $stored_key ) {
			return new WP_Error( 'verploy_not_configured', 'Verploy is not configured.', [ 'status' => 503 ] );
		}

		$auth   = $request->get_header( 'Authorization' );
		$bearer = str_replace( 'Bearer ', '', $auth );

		if ( ! hash_equals( $stored_key, $bearer ) ) {
			return new WP_Error( 'verploy_unauthorized', 'Invalid API key.', [ 'status' => 401 ] );
		}

		return true;
	}

	// ── Handlers ──────────────────────────────────────────────────────────────

	public static function status(): WP_REST_Response {
		return new WP_REST_Response( [
			'ok'         => true,
			'site_url'   => get_site_url(),
			'plugin_ver' => VERPLOY_VERSION,
			'wp_version' => get_bloginfo( 'version' ),
			'timestamp'  => gmdate( 'c' ),
		], 200 );
	}

	public static function health(): WP_REST_Response {
		$data = Verploy_Health_Collector::collect();
		return new WP_REST_Response( $data, 200 );
	}

	public static function trigger_update( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$type = $request->get_param( 'type' );
		$slug = $request->get_param( 'slug' );

		if ( in_array( $type, [ 'plugin', 'theme' ], true ) && ! $slug ) {
			return new WP_Error( 'verploy_missing_slug', 'Slug is required for plugin/theme updates.', [ 'status' => 400 ] );
		}

		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		require_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/update.php';

		$skin    = new Automatic_Upgrader_Skin();
		$result  = null;
		$success = false;

		switch ( $type ) {
			case 'plugin':
				wp_update_plugins();
				$upgrader = new Plugin_Upgrader( $skin );
				$result   = $upgrader->upgrade( $slug );
				$success  = ! is_wp_error( $result ) && $result !== false;
				break;

			case 'theme':
				wp_update_themes();
				$upgrader = new Theme_Upgrader( $skin );
				$result   = $upgrader->upgrade( $slug );
				$success  = ! is_wp_error( $result ) && $result !== false;
				break;

			case 'core':
				require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
				$upgrader = new Core_Upgrader( $skin );
				$result   = $upgrader->upgrade( get_bloginfo( 'version' ) );
				$success  = ! is_wp_error( $result );
				break;
		}

		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'verploy_update_failed', $result->get_error_message(), [ 'status' => 500 ] );
		}

		return new WP_REST_Response( [
			'success'  => $success,
			'type'     => $type,
			'slug'     => $slug,
			'messages' => $skin->get_upgrade_messages(),
		], 200 );
	}
}
