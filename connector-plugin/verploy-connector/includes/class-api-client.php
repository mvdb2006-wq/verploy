<?php
/**
 * Handles all outbound HTTP communication with the Verploy cloud API.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Verploy_API_Client {

	private string $api_key;
	private string $base_url;

	public function __construct( string $api_key, string $base_url = VERPLOY_API_BASE ) {
		$this->api_key  = $api_key;
		$this->base_url = rtrim( $base_url, '/' );
	}

	// ── Public methods ────────────────────────────────────────────────────────

	public function get( string $endpoint, array $params = [] ): array|WP_Error {
		$url = $this->base_url . $endpoint;
		if ( ! empty( $params ) ) {
			$url = add_query_arg( $params, $url );
		}
		return $this->request( 'GET', $url );
	}

	public function post( string $endpoint, array $body = [] ): array|WP_Error {
		return $this->request( 'POST', $this->base_url . $endpoint, $body );
	}

	public function put( string $endpoint, array $body = [] ): array|WP_Error {
		return $this->request( 'PUT', $this->base_url . $endpoint, $body );
	}

	// ── Core request ─────────────────────────────────────────────────────────

	private function request( string $method, string $url, array $body = [] ): array|WP_Error {
		$args = [
			'method'  => $method,
			'timeout' => 20,
			'headers' => [
				'Authorization' => 'Bearer ' . $this->api_key,
				'Content-Type'  => 'application/json',
				'X-Site-URL'    => get_site_url(),
				'X-Plugin-Ver'  => VERPLOY_VERSION,
				'Accept'        => 'application/json',
			],
		];

		if ( ! empty( $body ) ) {
			$args['body'] = wp_json_encode( $body );
		}

		$response = wp_remote_request( $url, $args );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$raw  = wp_remote_retrieve_body( $response );
		$data = json_decode( $raw, true );

		if ( $code >= 400 ) {
			$message = $data['message'] ?? "API error {$code}";
			return new WP_Error( 'verploy_api_error', $message, [ 'status' => $code ] );
		}

		return $data ?? [];
	}
}
