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
