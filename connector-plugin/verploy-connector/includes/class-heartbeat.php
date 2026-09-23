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

	const HOOK     = 'verploy_heartbeat';
	const OPT_LAST = 'verploy_last_heartbeat';

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'send' ) );
		add_filter( 'cron_schedules', array( __CLASS__, 'schedules' ) );
		// Zorgt dat de planning ook na een update (zonder heractivatie) bestaat.
		add_action( 'init', array( __CLASS__, 'ensure_scheduled' ) );
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
		return is_wp_error( $result ) ? $result : true;
	}
}
