<?php
/**
 * Inkomende REST-endpoints voor Verploy. Elk verzoek moet HMAC-ondertekend zijn;
 * het ondertekende pad is de REST-route (bijv. /verploy/v2/status), zodat het
 * werkt met zowel /wp-json/... als ?rest_route=...
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Rest_Endpoints {

	const NS = 'verploy/v2';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register' ) );
	}

	public static function register() {
		register_rest_route(
			self::NS,
			'/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'status' ),
				'permission_callback' => array( __CLASS__, 'authenticate' ),
			)
		);
		$run = array(
			'run_id' => array( 'required' => true, 'type' => 'string', 'validate_callback' => array( 'Verploy_Run_Engine', 'valid_run_id' ) ),
		);
		$routes = array(
			'/run/lock'        => array( 'lock', $run + array( 'ttl' => array( 'type' => 'integer', 'default' => 1800 ) ), false ),
			'/run/release'     => array( 'release', $run, false ),
			'/run/state'       => array( 'describe', $run, false ),
			'/staging/build'   => array( 'staging_build', $run, true ),
			'/updates/apply'   => array( 'apply', $run + array( 'item' => array( 'required' => true, 'type' => 'object' ) ), true ),
			'/snapshot/create' => array( 'snapshot', $run + array( 'items' => array( 'required' => true, 'type' => 'array' ) ), true ),
			'/maintenance'     => array( 'maintenance', $run + array( 'enabled' => array( 'required' => true, 'type' => 'boolean' ), 'ttl' => array( 'type' => 'integer', 'default' => 900 ) ), true ),
			'/rollback'        => array( 'rollback', $run, true ),
			'/cleanup'         => array( 'cleanup', $run, false ),
			'/run/pages'       => array( 'pages', $run + array( 'keys' => array( 'type' => array( 'array', 'null' ), 'default' => null ), 'extra_paths' => array( 'type' => 'array', 'default' => array() ) ), false ),
			'/heartbeat/now'   => array( 'heartbeat', $run, false ),
			'/run/diagnostics' => array( 'diagnostics', $run, false ),
		);
		foreach ( $routes as $route => $def ) {
			list( $method, $args, $needs_lock ) = $def;
			register_rest_route(
				self::NS,
				$route,
				array(
					'methods'             => 'POST',
					'args'                => $args,
					'permission_callback' => array( __CLASS__, 'authenticate' ),
					'callback'            => function ( WP_REST_Request $request ) use ( $method, $needs_lock ) {
						return Verploy_Rest_Endpoints::run_action( $method, $needs_lock, $request );
					},
				)
			);
		}
	}

	/**
	 * Voert een run-actie uit met lock-controle en nette foutafhandeling.
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public static function run_action( $method, $needs_lock, WP_REST_Request $request ) {
		$run_id = (string) $request->get_param( 'run_id' );
		if ( $needs_lock && ! Verploy_Run_Lock::holds( $run_id ) ) {
			return new WP_Error( 'verploy_not_locked', 'Run does not hold the site lock.', array( 'status' => 409 ) );
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 60 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
		@ignore_user_abort( true ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		try {
			switch ( $method ) {
				case 'lock':
					$r = Verploy_Run_Lock::acquire( $run_id, (int) $request->get_param( 'ttl' ) );
					return is_wp_error( $r ) ? $r : new WP_REST_Response( array( 'locked' => true ), 200 );
				case 'release':
					Verploy_Run_Lock::release( $run_id );
					return new WP_REST_Response( array( 'released' => true ), 200 );
				case 'describe':
					return new WP_REST_Response( Verploy_Run_Engine::describe( $run_id ), 200 );
				case 'staging_build':
					return new WP_REST_Response( Verploy_Run_Engine::staging_build( $run_id, new Verploy_Budget( 20 ) ), 200 );
				case 'apply':
					$item = (array) $request->get_param( 'item' );
					return new WP_REST_Response( Verploy_Run_Engine::apply_update( $item ), 200 );
				case 'snapshot':
					return new WP_REST_Response( Verploy_Run_Engine::snapshot_create( $run_id, (array) $request->get_param( 'items' ), new Verploy_Budget( 20 ) ), 200 );
				case 'maintenance':
					return new WP_REST_Response( Verploy_Run_Engine::set_maintenance( $run_id, (bool) $request->get_param( 'enabled' ), (int) $request->get_param( 'ttl' ) ), 200 );
				case 'rollback':
					return new WP_REST_Response( Verploy_Run_Engine::rollback( $run_id ), 200 );
				case 'pages':
					$keys = $request->get_param( 'keys' );
					return new WP_REST_Response( array( 'pages' => Verploy_Run_Engine::pages( is_array( $keys ) ? array_map( 'strval', $keys ) : null, array_map( 'strval', (array) $request->get_param( 'extra_paths' ) ) ) ), 200 );
				case 'diagnostics':
					return new WP_REST_Response( Verploy_Run_Engine::diagnostics( $run_id ), 200 );
				case 'heartbeat':
					$sent = Verploy_Heartbeat::send();
					return is_wp_error( $sent ) ? new WP_Error( 'verploy_heartbeat_failed', $sent->get_error_message(), array( 'status' => 502 ) ) : new WP_REST_Response( array( 'sent' => true ), 200 );
				case 'cleanup':
					return new WP_REST_Response( Verploy_Run_Engine::cleanup( $run_id ), 200 );
			}
		} catch ( Throwable $e ) {
			return new WP_Error( 'verploy_run_failed', $e->getMessage(), array( 'status' => 500 ) );
		}
		return new WP_Error( 'verploy_unknown_action', 'Unknown action.', array( 'status' => 400 ) );
	}

	/**
	 * @param WP_REST_Request $request
	 * @return true|WP_Error
	 */
	public static function authenticate( $request ) {
		if ( ! Verploy_Connection::is_connected() ) {
			return new WP_Error( 'verploy_not_connected', 'Not connected.', array( 'status' => 503 ) );
		}
		$headers = array();
		foreach ( array( 'x-verploy-site', 'x-verploy-timestamp', 'x-verploy-nonce', 'x-verploy-signature' ) as $name ) {
			$headers[ $name ] = (string) $request->get_header( $name );
		}
		$result = Verploy_Signer::verify(
			Verploy_Connection::site_id(),
			Verploy_Connection::secret(),
			$headers,
			$request->get_method(),
			$request->get_route(),
			(string) $request->get_body()
		);
		if ( true !== $result ) {
			return new WP_Error( 'verploy_unauthorized', 'Unauthorized.', array( 'status' => 401, 'reason' => $result ) );
		}
		return true;
	}

	public static function status() {
		return new WP_REST_Response(
			array(
				'ok'                => true,
				'connector_version' => VERPLOY_VERSION,
				'wp_version'        => get_bloginfo( 'version' ),
				'php_version'       => PHP_VERSION,
				'site_url'          => home_url(),
				'staging'           => Verploy_Heartbeat::disabled(),
			),
			200
		);
	}
}
