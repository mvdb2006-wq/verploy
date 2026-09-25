<?php
/**
 * Automatic update checker for the Verploy Connector plugin.
 * Polls the Verploy API once per 12 hours; shows standard WordPress update notices.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Verploy_Updater {

	const UPDATE_URL  = 'https://app.verploy.com/api/v1/plugin/update-info';
	const PLUGIN_SLUG = 'verploy-connector/verploy-connector.php';
	const CACHE_KEY   = 'verploy_update_info';
	const CACHE_HOURS = 12;

	public static function init() {
		add_filter( 'pre_set_site_transient_update_plugins', [ __CLASS__, 'check_for_update' ] );
		add_filter( 'plugins_api',                           [ __CLASS__, 'plugin_info' ], 10, 3 );
	}

	/**
	 * Vergeet wat bekend was over updates en kijk opnieuw (ook bij wordpress.org), zodat een nieuwe versie
	 * van deze plugin meteen zichtbaar is in plaats van pas na 12 uur. Gebruikt als Verploy meldt dat er een
	 * nieuwe versie is, en vlak voordat Verploy deze plugin zelf bijwerkt.
	 */
	public static function refresh() {
		require_once ABSPATH . 'wp-admin/includes/update.php';
		delete_transient( self::CACHE_KEY );
		delete_site_transient( 'update_plugins' );
		wp_update_plugins();
	}

	/** Verploy meldt (in het antwoord op de heartbeat) welke versie de nieuwste is. */
	public static function maybe_refresh_for( $latest ) {
		if ( ! is_string( $latest ) || ! preg_match( '/^[0-9]+(\.[0-9]+){1,3}$/', $latest ) || ! version_compare( $latest, VERPLOY_VERSION, '>' ) ) {
			return false;
		}
		if ( get_option( 'verploy_refreshed_for' ) === $latest ) {
			return false;   // al gedaan voor deze versie; niet bij elke heartbeat opnieuw
		}
		update_option( 'verploy_refreshed_for', $latest, false );
		self::refresh();
		return true;
	}

	private static function fetch_info() {
		$cached = get_transient( self::CACHE_KEY );
		if ( $cached !== false ) return $cached;

		$response = wp_remote_get( self::UPDATE_URL, array( 'timeout' => 10 ) );
		if ( is_wp_error( $response ) ) return null;

		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! isset( $data['version'], $data['download_url'] ) || ! preg_match( '/^[0-9.]+$/', (string) $data['version'] ) ) return null;

		set_transient( self::CACHE_KEY, $data, self::CACHE_HOURS * HOUR_IN_SECONDS );
		return $data;
	}

	public static function check_for_update( $transient ) {
		if ( empty( $transient->checked ) ) return $transient;

		$info = self::fetch_info();
		if ( ! $info ) return $transient;

		if ( version_compare( $info['version'], VERPLOY_VERSION, '>' ) ) {
			$transient->response[ self::PLUGIN_SLUG ] = (object) [
				'id'           => self::PLUGIN_SLUG,
				'slug'         => 'verploy-connector',
				'plugin'       => self::PLUGIN_SLUG,
				'new_version'  => $info['version'],
				'url'          => $info['details_url'] ?? 'https://verploy.com',
				'package'      => $info['download_url'],
				'tested'       => $info['tested_up_to'] ?? '',
				'requires'     => $info['requires'] ?? '',
				'requires_php' => $info['requires_php'] ?? '',
				'icons'        => [], 'banners' => [], 'banners_rtl' => [],
				'upgrade_notice' => '', 'compatibility' => new \stdClass(),
			];
		} else {
			$transient->no_update[ self::PLUGIN_SLUG ] = (object) [
				'id' => self::PLUGIN_SLUG, 'slug' => 'verploy-connector',
				'plugin' => self::PLUGIN_SLUG, 'new_version' => VERPLOY_VERSION,
				'url' => $info['details_url'] ?? 'https://verploy.com',
				'package' => $info['download_url'],
				'icons' => [], 'banners' => [], 'compatibility' => new \stdClass(),
			];
		}

		return $transient;
	}

	public static function plugin_info( $result, $action, $args ) {
		if ( $action !== 'plugin_information' ) return $result;
		if ( ( $args->slug ?? '' ) !== 'verploy-connector' ) return $result;

		$info = self::fetch_info();
		if ( ! $info ) return $result;

		return (object) [
			'name'          => 'Verploy Connector',
			'slug'          => 'verploy-connector',
			'version'       => $info['version'],
			'author'        => 'Verploy',
			'homepage'      => $info['details_url'] ?? 'https://verploy.com',
			'download_link' => $info['download_url'],
			'requires'      => $info['requires'] ?? '5.8',
			'tested'        => $info['tested_up_to'] ?? '6.7',
			'requires_php'  => $info['requires_php'] ?? '7.4',
			'sections'      => [ 'description' => 'Connects your WordPress site to Verploy for health monitoring and update management.' ],
		];
	}
}
