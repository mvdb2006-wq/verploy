<?php
/**
 * Verzamelt health-data voor de heartbeat (schema 2, zie dashboard/src/lib/connector/payload.ts).
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Health_Collector {

	/**
	 * @return array
	 */
	public static function collect() {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return array(
			'schema'            => 2,
			'collected_at'      => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'connector_version' => VERPLOY_VERSION,
			'site'              => array(
				'url'       => home_url(),
				'name'      => wp_strip_all_tags( get_bloginfo( 'name' ) ),
				'locale'    => get_locale(),
				'timezone'  => wp_timezone_string(),
				'multisite' => is_multisite(),
			),
			'server'            => self::server(),
			'wordpress'         => self::core(),
			'plugins'           => self::plugins(),
			'themes'            => self::themes(),
			// Voor "Inloggen in WP Admin" vanuit Verploy: welke beheerders er zijn en of het aan staat.
			'admins'            => Verploy_Sso::admins(),
			'sso'               => array( 'enabled' => Verploy_Sso::enabled() ),
		);
	}

	private static function server() {
		global $wpdb;
		$disk = function_exists( 'disk_free_space' ) ? @disk_free_space( ABSPATH ) : false; // phpcs:ignore WordPress.PHP.NoSilencedErrors -- kan uitgeschakeld zijn.
		return array(
			'php_version'        => self::clean_version( PHP_VERSION ),
			'memory_limit'       => (string) ini_get( 'memory_limit' ),
			'memory_peak_bytes'  => (int) memory_get_peak_usage( true ),
			'max_execution_time' => (int) ini_get( 'max_execution_time' ),
			'disk_free_bytes'    => false === $disk ? null : (float) $disk,
			'mysql_version'      => $wpdb->db_server_info() ? substr( (string) $wpdb->db_server_info(), 0, 80 ) : null,
			'db_size_bytes'      => self::db_size(),
		);
	}

	private static function db_size() {
		global $wpdb;
		$size = $wpdb->get_var( $wpdb->prepare( 'SELECT SUM(data_length + index_length) FROM information_schema.TABLES WHERE table_schema = %s', DB_NAME ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- databasegrootte, eens per heartbeat
		return null === $size ? null : (float) $size;
	}

	private static function core() {
		$version = self::clean_version( get_bloginfo( 'version' ) );
		$update  = get_site_transient( 'update_core' );
		$latest  = null;
		if ( is_object( $update ) && ! empty( $update->updates ) ) {
			foreach ( $update->updates as $offer ) {
				if ( isset( $offer->response ) && 'upgrade' === $offer->response && ! empty( $offer->current ) ) {
					$latest = self::clean_version( $offer->current );
					break;
				}
			}
		}
		return array(
			'version'          => $version,
			'update_available' => null !== $latest && version_compare( $latest, $version, '>' ),
			'update_version'   => $latest,
		);
	}

	/**
	 * De lijst met beschikbare updates van WordPress, zo nodig eerst opnieuw opgehaald. Na elke update
	 * (in WP Admin of door Verploy) wist WordPress die lijst; zonder opnieuw kijken zou de heartbeat dan
	 * "geen updates" melden tot WordPress uit zichzelf weer kijkt (tot 12 uur later).
	 *
	 * @param string $kind 'plugins' of 'themes'.
	 */
	private static function update_list( $kind ) {
		$key     = 'update_' . $kind;
		$updates = get_site_transient( $key );
		if ( ! is_object( $updates ) || empty( $updates->last_checked ) || ! isset( $updates->checked ) || array() === $updates->checked ) {
			require_once ABSPATH . 'wp-admin/includes/update.php';
			if ( 'plugins' === $kind ) {
				wp_update_plugins();
			} else {
				wp_update_themes();
			}
			$updates = get_site_transient( $key );
		}
		return $updates;
	}

	private static function plugins() {
		$updates = self::update_list( 'plugins' );
		$out     = array();
		foreach ( get_plugins() as $file => $data ) {
			$new   = ( is_object( $updates ) && isset( $updates->response[ $file ]->new_version ) ) ? self::clean_version( $updates->response[ $file ]->new_version ) : null;
			$out[] = array(
				'file'             => (string) $file,
				'name'             => wp_strip_all_tags( (string) $data['Name'] ),
				'version'          => self::clean_version( $data['Version'] ),
				'active'           => is_plugin_active( $file ),
				'update_available' => null !== $new,
				'update_version'   => $new,
			);
		}
		return $out;
	}

	private static function themes() {
		$updates = self::update_list( 'themes' );
		$active  = get_stylesheet();
		$out     = array();
		foreach ( wp_get_themes() as $slug => $theme ) {
			$new   = ( is_object( $updates ) && isset( $updates->response[ $slug ]['new_version'] ) ) ? self::clean_version( $updates->response[ $slug ]['new_version'] ) : null;
			$out[] = array(
				'slug'             => (string) $slug,
				'name'             => wp_strip_all_tags( (string) $theme->get( 'Name' ) ),
				'version'          => self::clean_version( $theme->get( 'Version' ) ),
				'active'           => $slug === $active,
				'update_available' => null !== $new,
				'update_version'   => $new,
			);
		}
		return $out;
	}

	/**
	 * Houdt alleen tekens over die in een versie horen (de API weigert andere).
	 *
	 * @return string|null
	 */
	private static function clean_version( $v ) {
		$v = preg_replace( '/[^0-9A-Za-z.+_-]/', '', (string) $v );
		return '' === $v ? null : substr( $v, 0, 40 );
	}
}
