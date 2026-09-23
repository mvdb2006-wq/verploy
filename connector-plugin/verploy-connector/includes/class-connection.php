<?php
/**
 * Koppeling met Verploy: site-id + secret opslaan, koppelen via koppelcode, ontkoppelen.
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Connection {

	const OPT_SITE_ID   = 'verploy_site_id';
	const OPT_SECRET    = 'verploy_secret';
	const OPT_PAIRED_AT = 'verploy_paired_at';

	public static function is_connected() {
		return '' !== self::site_id() && '' !== self::secret();
	}

	public static function site_id() {
		return (string) get_option( self::OPT_SITE_ID, '' );
	}

	public static function secret() {
		return (string) get_option( self::OPT_SECRET, '' );
	}

	/**
	 * Wisselt een koppelcode in bij Verploy.
	 *
	 * @param string $code Koppelcode uit het dashboard.
	 * @return true|WP_Error
	 */
	public static function pair( $code ) {
		$code = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $code ) );
		if ( strlen( $code ) < 8 ) {
			return new WP_Error( 'verploy_invalid_code', __( 'Vul de koppelcode van 8 tekens in.', 'verploy-connector' ) );
		}
		$response = Verploy_Api_Client::post_unsigned(
			'/connect',
			array(
				'code'              => $code,
				'site_url'          => home_url(),
				'connector_version' => VERPLOY_VERSION,
			)
		);
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		if ( empty( $response['site_id'] ) || empty( $response['secret'] ) || ! preg_match( '/^[0-9a-f]{64}$/', (string) $response['secret'] ) ) {
			return new WP_Error( 'verploy_bad_response', __( 'Onverwacht antwoord van Verploy. Probeer het opnieuw.', 'verploy-connector' ) );
		}
		update_option( self::OPT_SITE_ID, sanitize_text_field( $response['site_id'] ), false );
		update_option( self::OPT_SECRET, (string) $response['secret'], false );
		update_option( self::OPT_PAIRED_AT, gmdate( 'c' ), false );
		delete_option( 'verploy_api_key' ); // restant van 1.x
		return true;
	}

	public static function disconnect() {
		delete_option( self::OPT_SITE_ID );
		delete_option( self::OPT_SECRET );
		delete_option( self::OPT_PAIRED_AT );
		delete_option( Verploy_Heartbeat::OPT_LAST );
	}
}
