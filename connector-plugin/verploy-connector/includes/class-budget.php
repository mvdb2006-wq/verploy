<?php
/**
 * Tijdsbudget per verzoek. Gedeelde hosting heeft vaak max_execution_time = 30 s;
 * zwaar werk wordt daarom in stukken gedaan en hervat bij het volgende verzoek.
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Budget {

	/** @var float */
	private $deadline;

	/**
	 * @param float $seconds Gewenste werktijd; wordt begrensd door max_execution_time.
	 */
	public function __construct( $seconds = 20.0 ) {
		$max = (int) ini_get( 'max_execution_time' );
		if ( $max > 0 ) {
			$seconds = min( $seconds, max( 5, $max * 0.6 ) );
		}
		$this->deadline = microtime( true ) + $seconds;
	}

	public function left() {
		return $this->deadline - microtime( true );
	}

	public function expired() {
		return microtime( true ) >= $this->deadline;
	}
}
