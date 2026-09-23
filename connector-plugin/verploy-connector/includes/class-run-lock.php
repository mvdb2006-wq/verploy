<?php
/**
 * Eén update-run tegelijk per site. Een lock verloopt vanzelf (vangnet bij een crash).
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Run_Lock {

	const OPTION = 'verploy_run_lock';

	/**
	 * @return true|WP_Error
	 */
	public static function acquire( $run_id, $ttl ) {
		$ttl     = max( 60, min( 7200, (int) $ttl ) );
		$current = get_option( self::OPTION );
		if ( is_array( $current ) && $current['run_id'] !== $run_id && $current['expires'] > time() ) {
			return new WP_Error( 'verploy_locked', 'Another run holds the lock.', array( 'status' => 409, 'run_id' => $current['run_id'] ) );
		}
		update_option( self::OPTION, array( 'run_id' => $run_id, 'expires' => time() + $ttl ), false );
		return true;
	}

	public static function holds( $run_id ) {
		$current = get_option( self::OPTION );
		return is_array( $current ) && $current['run_id'] === $run_id && $current['expires'] > time();
	}

	public static function release( $run_id ) {
		$current = get_option( self::OPTION );
		if ( is_array( $current ) && $current['run_id'] === $run_id ) {
			delete_option( self::OPTION );
		}
	}
}
