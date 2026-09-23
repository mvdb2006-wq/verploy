<?php
/**
 * HMAC-SHA256 request-ondertekening — identiek aan dashboard/src/lib/security/signing.ts.
 *
 *   canonical = METHOD \n PATH \n TIMESTAMP \n NONCE \n sha256_hex(body)
 *   signature = hex(HMAC-SHA256(secret, canonical))
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Signer {

	const WINDOW_SECONDS = 300;

	/**
	 * @param string $method HTTP-methode.
	 * @param string $path   Pad (uitgaand: URL-pad; inkomend: REST-route).
	 * @param string $timestamp Unix-tijd in seconden.
	 * @param string $nonce  32 hex-tekens.
	 * @param string $body   Exacte body-bytes.
	 * @return string
	 */
	public static function canonical( $method, $path, $timestamp, $nonce, $body ) {
		return implode( "\n", array( strtoupper( $method ), $path, $timestamp, $nonce, hash( 'sha256', $body ) ) );
	}

	/**
	 * @return string 64 hex-tekens.
	 */
	public static function sign( $secret, $method, $path, $timestamp, $nonce, $body ) {
		return hash_hmac( 'sha256', self::canonical( $method, $path, $timestamp, $nonce, $body ), $secret );
	}

	/**
	 * @return string 32 hex-tekens.
	 */
	public static function nonce() {
		return bin2hex( random_bytes( 16 ) );
	}

	/**
	 * Headers voor een uitgaand, ondertekend request.
	 *
	 * @return array<string,string>
	 */
	public static function headers( $site_id, $secret, $method, $path, $body ) {
		$timestamp = (string) time();
		$nonce     = self::nonce();
		return array(
			'X-Verploy-Site'      => $site_id,
			'X-Verploy-Timestamp' => $timestamp,
			'X-Verploy-Nonce'     => $nonce,
			'X-Verploy-Signature' => self::sign( $secret, $method, $path, $timestamp, $nonce, $body ),
		);
	}

	/**
	 * Controleert een inkomend request: vorm, tijdvenster, handtekening (constante tijd)
	 * en eenmaligheid van de nonce.
	 *
	 * @param string $site_id   Verwachte site-id.
	 * @param string $secret    Site-secret.
	 * @param array  $headers   Kleine-letter-headers => waarde.
	 * @param string $method    HTTP-methode.
	 * @param string $path      REST-route, bijv. /verploy/v2/status.
	 * @param string $body      Exacte body.
	 * @param int    $now       Huidige tijd (test-injectie).
	 * @return true|string True of een foutcode.
	 */
	public static function verify( $site_id, $secret, $headers, $method, $path, $body, $now = null ) {
		$now       = null === $now ? time() : (int) $now;
		$got_site  = isset( $headers['x-verploy-site'] ) ? (string) $headers['x-verploy-site'] : '';
		$timestamp = isset( $headers['x-verploy-timestamp'] ) ? (string) $headers['x-verploy-timestamp'] : '';
		$nonce     = isset( $headers['x-verploy-nonce'] ) ? (string) $headers['x-verploy-nonce'] : '';
		$signature = isset( $headers['x-verploy-signature'] ) ? (string) $headers['x-verploy-signature'] : '';

		if ( ! preg_match( '/^\d{9,12}$/', $timestamp ) || ! preg_match( '/^[0-9a-f]{32}$/', $nonce ) || ! preg_match( '/^[0-9a-f]{64}$/', $signature ) ) {
			return 'missing_signature';
		}
		if ( ! hash_equals( (string) $site_id, $got_site ) ) {
			return 'unknown_site';
		}
		if ( abs( $now - (int) $timestamp ) > self::WINDOW_SECONDS ) {
			return 'stale';
		}
		$expected = self::sign( $secret, $method, $path, $timestamp, $nonce, $body );
		if ( ! hash_equals( $expected, $signature ) ) {
			return 'bad_signature';
		}
		$key = 'verploy_nonce_' . $nonce;
		if ( false !== get_transient( $key ) ) {
			return 'replay';
		}
		set_transient( $key, 1, 2 * self::WINDOW_SECONDS );
		return true;
	}
}
