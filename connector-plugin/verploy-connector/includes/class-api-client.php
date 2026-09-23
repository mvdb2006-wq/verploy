<?php
/**
 * Uitgaande HTTP-verzoeken naar Verploy. Alles behalve /connect is HMAC-ondertekend.
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Api_Client {

	/**
	 * @return array|WP_Error Gedecodeerde JSON of fout.
	 */
	public static function post_unsigned( $endpoint, array $body ) {
		return self::request( 'POST', $endpoint, wp_json_encode( $body ), array() );
	}

	/**
	 * @return array|WP_Error
	 */
	public static function signed( $method, $endpoint, $body = null ) {
		if ( ! Verploy_Connection::is_connected() ) {
			return new WP_Error( 'verploy_not_connected', __( 'Deze site is nog niet gekoppeld aan Verploy.', 'verploy-connector' ) );
		}
		$raw     = null === $body ? '' : wp_json_encode( $body );
		$path    = (string) wp_parse_url( VERPLOY_API_BASE . $endpoint, PHP_URL_PATH );
		$headers = Verploy_Signer::headers( Verploy_Connection::site_id(), Verploy_Connection::secret(), $method, $path, $raw );
		return self::request( $method, $endpoint, $raw, $headers );
	}

	/**
	 * @return array|WP_Error
	 */
	private static function request( $method, $endpoint, $raw, array $headers ) {
		$args = array(
			'method'      => $method,
			'timeout'     => 20,
			'redirection' => 0,
			'headers'     => array_merge(
				array(
					'Content-Type' => 'application/json',
					'Accept'       => 'application/json',
					'User-Agent'   => 'VerployConnector/' . VERPLOY_VERSION . '; ' . home_url(),
				),
				$headers
			),
		);
		if ( '' !== $raw && 'GET' !== $method ) {
			$args['body'] = $raw;
		}
		$response = wp_remote_request( VERPLOY_API_BASE . $endpoint, $args );
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$data = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$data = is_array( $data ) ? $data : array();
		if ( $code >= 400 ) {
			return new WP_Error( 'verploy_http_' . $code, self::error_message( $code, $data ), array( 'status' => $code, 'body' => $data ) );
		}
		return $data;
	}

	private static function error_message( $code, array $data ) {
		$error = isset( $data['error'] ) ? (string) $data['error'] : '';
		switch ( $error ) {
			case 'invalid_code':
				return __( 'Deze koppelcode is ongeldig, verlopen of al gebruikt. Maak in Verploy een nieuwe code.', 'verploy-connector' );
			case 'site_url_mismatch':
				/* translators: %s: het adres dat in Verploy is ingesteld. */
				return sprintf( __( 'Deze code hoort bij een ander site-adres (%s). Controleer het adres in Verploy.', 'verploy-connector' ), isset( $data['expected_url'] ) ? esc_url_raw( $data['expected_url'] ) : '?' );
			case 'unauthorized':
				return __( 'Verploy herkent deze site niet meer. Koppel de site opnieuw met een nieuwe code.', 'verploy-connector' );
		}
		if ( isset( $data['message'] ) ) {
			return sanitize_text_field( (string) $data['message'] );
		}
		/* translators: %d: HTTP-statuscode. */
		return sprintf( __( 'Verploy gaf een fout terug (HTTP %d).', 'verploy-connector' ), $code );
	}
}
