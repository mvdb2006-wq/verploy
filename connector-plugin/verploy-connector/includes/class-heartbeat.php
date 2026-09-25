<?php
/**
 * Stuurt elke 15 minuten (WP-Cron) een ondertekende heartbeat naar Verploy.
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Heartbeat {

	const HOOK        = 'verploy_heartbeat';
	const HOOK_SOON   = 'verploy_heartbeat_soon';
	const OPT_LAST    = 'verploy_last_heartbeat';
	const OPT_VERSION = 'verploy_version_seen';

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'send' ) );
		add_action( self::HOOK_SOON, array( __CLASS__, 'send' ) );
		// Iets veranderd in WP Admin (plugin of thema bijgewerkt, (de)geactiveerd, WordPress bijgewerkt)?
		// Dan binnen enkele seconden een heartbeat, zodat Verploy het meteen ziet (niet pas na 15 minuten).
		add_action( 'upgrader_process_complete', array( __CLASS__, 'soon' ) );
		add_action( 'activated_plugin', array( __CLASS__, 'soon' ) );
		add_action( 'deactivated_plugin', array( __CLASS__, 'soon' ) );
		add_action( 'deleted_plugin', array( __CLASS__, 'soon' ) );
		add_action( 'switch_theme', array( __CLASS__, 'soon' ) );
		add_action( '_core_updated_successfully', array( __CLASS__, 'soon' ) );
		// Deze plugin zelf bijgewerkt (ook via uploaden): de nieuwe versie meldt zich direct.
		add_action( 'init', array( __CLASS__, 'check_version' ) );
		add_filter( 'cron_schedules', array( __CLASS__, 'schedules' ) );
		// Zorgt dat de planning ook na een update (zonder heractivatie) bestaat.
		add_action( 'init', array( __CLASS__, 'ensure_scheduled' ) );
	}

	/** Plant één heartbeat over enkele seconden (dubbele aanroepen samen: er staat er hooguit één klaar). */
	public static function soon() {
		if ( self::disabled() || ! Verploy_Connection::is_connected() ) {
			return;
		}
		if ( ! wp_next_scheduled( self::HOOK_SOON ) ) {
			wp_schedule_single_event( time() + 5, self::HOOK_SOON );
		}
	}

	/** Na een update van de connector: eenmalig direct een heartbeat met de nieuwe versie. */
	public static function check_version() {
		if ( get_option( self::OPT_VERSION ) === VERPLOY_VERSION ) {
			return;
		}
		update_option( self::OPT_VERSION, VERPLOY_VERSION, true );
		self::soon();
	}

	public static function schedules( $schedules ) {
		$schedules['verploy_15min'] = array(
			'interval' => 900,
			'display'  => __( 'Elke 15 minuten (Verploy)', 'verploy-connector' ),
		);
		return $schedules;
	}

	public static function ensure_scheduled() {
		if ( self::disabled() ) {
			wp_clear_scheduled_hook( self::HOOK );
			return;
		}
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + 60, 'verploy_15min', self::HOOK );
		}
	}

	/**
	 * Staging-kopieën (fase 4) definiëren VERPLOY_STAGING: die mogen nooit heartbeats sturen.
	 */
	public static function disabled() {
		return defined( 'VERPLOY_STAGING' ) && VERPLOY_STAGING;
	}

	/**
	 * @return true|WP_Error
	 */
	public static function send() {
		if ( self::disabled() || ! Verploy_Connection::is_connected() ) {
			return new WP_Error( 'verploy_not_connected', __( 'Deze site is nog niet gekoppeld aan Verploy.', 'verploy-connector' ) );
		}
		$result = Verploy_Api_Client::signed( 'POST', '/heartbeat', Verploy_Health_Collector::collect() );
		update_option(
			self::OPT_LAST,
			array(
				'time'    => time(),
				'success' => ! is_wp_error( $result ),
				'error'   => is_wp_error( $result ) ? $result->get_error_message() : null,
			),
			false
		);
		// Nieuwe versie van deze plugin? Direct opnieuw kijken en meteen melden, zodat Verploy hem kan uitrollen.
		if ( ! is_wp_error( $result ) && isset( $result['connector_latest'] ) && class_exists( 'Verploy_Updater' ) && Verploy_Updater::maybe_refresh_for( $result['connector_latest'] ) ) {
			self::soon();
		}
		return is_wp_error( $result ) ? $result : true;
	}
}
