<?php
/**
 * Inloggen vanuit Verploy (één klik naar WP Admin), zonder wachtwoorden.
 *
 * Verploy stuurt de browser met een POST naar wp-login.php?action=verploy_sso met een token:
 *   base64url(JSON) . "." . hex(HMAC-SHA256(site-secret, "sso|" . base64url(JSON)))
 * JSON: {"v":1,"site":"<site-id>","aud":"<site-url>","user":<wp-user-id>,"by":"<e-mail Verploy-gebruiker>","nonce":"<32 hex>","iat":<unix>,"exp":<unix>}
 *
 * Het token is hooguit 60 seconden geldig, precies één keer bruikbaar (atomair vastgelegd), alleen voor deze
 * site op dit adres (niet voor een kloon of testkopie) en voor één bestaande beheerder. Let op: zoals elke
 * login zonder wachtwoord slaat dit een 2FA-plugin van de site over. De site-eigenaar kan het uitzetten op de Verploy-instellingenpagina in WP Admin.
 * Elke login komt in het logboek op de site (en in Verploy).
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Sso {

	const OPT_ENABLED = 'verploy_sso_enabled';
	const OPT_LOG     = 'verploy_sso_log';
	const MAX_AGE     = 60;
	const SKEW        = 60;
	const LOG_SIZE    = 50;

	public static function init() {
		add_action( 'login_form_verploy_sso', array( __CLASS__, 'handle' ) );
	}

	/** Staat inloggen vanuit Verploy aan? (standaard ja; de site-eigenaar kan het uitzetten) */
	public static function enabled() {
		return '0' !== (string) get_option( self::OPT_ENABLED, '1' );
	}

	/**
	 * Beheerders die Verploy mag gebruiken om in te loggen (voor de keuze in Verploy).
	 *
	 * @return array<int, array{id:int, login:string, name:string}>
	 */
	public static function admins() {
		$users = get_users(
			array(
				'role'    => 'administrator',
				'orderby' => 'ID',
				'order'   => 'ASC',
				'number'  => 20,
				'fields'  => array( 'ID', 'user_login', 'display_name' ),
			)
		);
		$out = array();
		foreach ( $users as $u ) {
			$out[] = array(
				'id'    => (int) $u->ID,
				'login' => substr( (string) $u->user_login, 0, 60 ),
				'name'  => substr( wp_strip_all_tags( (string) $u->display_name ), 0, 100 ),
			);
		}
		return $out;
	}

	/**
	 * Controleert een token. Geeft de payload terug, of een foutcode.
	 *
	 * @param string $token  Het token uit het formulier.
	 * @param string $site   Site-id van deze koppeling.
	 * @param string $secret Site-secret.
	 * @param int    $now    Huidige tijd (test-injectie).
	 * @return array|string
	 */
	public static function verify( $token, $site, $secret, $now = null, $home = null ) {
		$now = null === $now ? time() : (int) $now;
		if ( '' === $site || '' === $secret ) {
			return 'not_connected';
		}
		if ( ! is_string( $token ) || strlen( $token ) > 2048 || ! preg_match( '/^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/', $token, $m ) ) {
			return 'malformed';
		}
		$expected = hash_hmac( 'sha256', 'sso|' . $m[1], $secret );
		if ( ! hash_equals( $expected, $m[2] ) ) {
			return 'bad_signature';
		}
		$json = base64_decode( strtr( $m[1], '-_', '+/' ), true );
		$data = false === $json ? null : json_decode( $json, true );
		if ( ! is_array( $data ) || 1 !== ( $data['v'] ?? null ) ) {
			return 'malformed';
		}
		foreach ( array( 'site', 'aud', 'by', 'nonce' ) as $k ) {
			if ( ! isset( $data[ $k ] ) || ! is_string( $data[ $k ] ) ) {
				return 'malformed';
			}
		}
		foreach ( array( 'user', 'iat', 'exp' ) as $k ) {
			if ( ! isset( $data[ $k ] ) || ! is_int( $data[ $k ] ) ) {
				return 'malformed';
			}
		}
		if ( ! hash_equals( $site, $data['site'] ) ) {
			return 'wrong_site';
		}
		if ( self::normalize_url( $data['aud'] ) !== self::normalize_url( null === $home ? home_url() : $home ) ) {
			return 'wrong_site';
		}
		if ( ! preg_match( '/^[0-9a-f]{32}$/', $data['nonce'] ) ) {
			return 'malformed';
		}
		if ( $data['exp'] < $now || $data['exp'] - $data['iat'] > self::MAX_AGE || $data['iat'] > $now + self::SKEW ) {
			return 'expired';
		}
		return $data;
	}

	/** "HTTPS://Klant.nl/" → "https://klant.nl" (vergelijken van het adres waarvoor het token is). */
	public static function normalize_url( $url ) {
		$p = wp_parse_url( trim( (string) $url, " \t\n\r\0\x0B" ) );
		if ( ! is_array( $p ) || empty( $p['host'] ) ) {
			return '';
		}
		$port = isset( $p['port'] ) ? ':' . $p['port'] : '';
		$path = isset( $p['path'] ) ? rtrim( $p['path'], '/' ) : '';
		return strtolower( ( $p['scheme'] ?? 'https' ) . '://' . $p['host'] . $port ) . $path;
	}

	/**
	 * Legt de nonce atomair vast: true als hij nieuw was, false als hij al gebruikt is (ook bij twee
	 * gelijktijdige verzoeken en los van een object-cache). Ruimt oude nonces meteen op.
	 */
	private static function claim_nonce( $nonce ) {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND option_value < %d", $wpdb->esc_like( 'verploy_sso_n_' ) . '%', time() - 600 ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- opruimen van verlopen nonces
		$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')", 'verploy_sso_n_' . $nonce, (string) time() ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- atomair: precies één verzoek mag de nonce vastleggen
		return 1 === (int) $wpdb->rows_affected;
	}

	/** Verwerkt de POST naar wp-login.php?action=verploy_sso. */
	public static function handle() {
		if ( 'POST' !== ( isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) : '' ) ) {
			self::fail( 'method' );
		}
		// Nooit op een testkopie van Verploy (die heeft een kopie van de opties, inclusief het secret).
		if ( ! self::enabled() || defined( 'VERPLOY_STAGING' ) ) {
			self::fail( 'disabled' );
		}
		$token = isset( $_POST['token'] ) ? sanitize_text_field( wp_unslash( $_POST['token'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- eigen HMAC-token met eenmalige nonce
		$data  = self::verify( $token, Verploy_Connection::site_id(), Verploy_Connection::secret() );
		if ( ! is_array( $data ) ) {
			self::fail( $data );
		}
		// Eenmalig: dezelfde nonce nooit twee keer, ook niet bij twee gelijktijdige verzoeken.
		if ( ! self::claim_nonce( $data['nonce'] ) ) {
			self::fail( 'replay' );
		}

		$user = get_user_by( 'id', $data['user'] );
		if ( ! $user || ! user_can( $user, 'manage_options' ) ) {
			self::fail( 'not_admin' );
		}
		wp_clear_auth_cookie();
		wp_set_current_user( $user->ID );
		wp_set_auth_cookie( $user->ID, false, is_ssl() );
		do_action( 'wp_login', $user->user_login, $user ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- core-hook, zodat beveiligingsplugins de login zien
		self::log( $user, $data['by'] );
		wp_safe_redirect( admin_url() );
		exit;
	}

	/** Logboek op de site: wie van Verploy logde in, als welke beheerder, wanneer en vanaf welk IP. */
	private static function log( $user, $by ) {
		$log = get_option( self::OPT_LOG, array() );
		$log = is_array( $log ) ? $log : array();
		array_unshift(
			$log,
			array(
				'time' => time(),
				'by'   => substr( sanitize_email( $by ), 0, 190 ),
				'user' => $user->user_login,
				'ip'   => isset( $_SERVER['REMOTE_ADDR'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ), 0, 45 ) : '',
			)
		);
		update_option( self::OPT_LOG, array_slice( $log, 0, self::LOG_SIZE ), false );
	}

	/**
	 * Recente logins (voor de instellingenpagina).
	 *
	 * @return array<int, array{time:int, by:string, user:string, ip:string}>
	 */
	public static function recent() {
		$log = get_option( self::OPT_LOG, array() );
		return is_array( $log ) ? array_slice( $log, 0, 10 ) : array();
	}

	private static function fail( $code ) {
		$messages = array(
			'disabled' => __( 'Inloggen vanuit Verploy staat uit op deze site (Instellingen → Verploy).', 'verploy-connector' ),
			'expired'  => __( 'Deze inloglink is verlopen. Klik in Verploy opnieuw op “Inloggen in WP Admin”.', 'verploy-connector' ),
			'replay'   => __( 'Deze inloglink is al gebruikt. Klik in Verploy opnieuw op “Inloggen in WP Admin”.', 'verploy-connector' ),
		);
		$message = isset( $messages[ $code ] ) ? $messages[ $code ] : __( 'Inloggen vanuit Verploy is niet gelukt. Log gewoon in met je eigen gebruikersnaam en wachtwoord.', 'verploy-connector' );
		wp_die(
			esc_html( $message ) . ' <a href="' . esc_url( wp_login_url() ) . '">' . esc_html__( 'Naar het inlogscherm', 'verploy-connector' ) . '</a>',
			esc_html__( 'Inloggen vanuit Verploy', 'verploy-connector' ),
			array( 'response' => 403 )
		);
	}
}
