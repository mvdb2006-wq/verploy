<?php
/**
 * Upgrader-skin die uitvoer opvangt in plaats van te tonen. Mag pas geladen worden
 * NA wp-admin/includes/class-wp-upgrader.php (anders bestaat WP_Upgrader_Skin nog niet —
 * zie het 1.3.0-incident in PLAN.md).
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Verploy_Quiet_Skin' ) ) {
	class Verploy_Quiet_Skin extends WP_Upgrader_Skin {

		/** @var string[] */
		private $lines = array();

		public function header() {}

		public function footer() {}

		public function feedback( $feedback, ...$args ) {
			if ( is_string( $feedback ) && isset( $this->upgrader->strings[ $feedback ] ) ) {
				$feedback = $this->upgrader->strings[ $feedback ];
			}
			if ( is_string( $feedback ) && '' !== $feedback ) {
				$this->lines[] = wp_strip_all_tags( $args ? vsprintf( $feedback, $args ) : $feedback );
			}
		}

		public function error( $errors ) {
			if ( is_wp_error( $errors ) ) {
				foreach ( $errors->get_error_messages() as $m ) {
					$this->lines[] = 'Error: ' . wp_strip_all_tags( $m );
				}
			} elseif ( is_string( $errors ) ) {
				$this->lines[] = 'Error: ' . wp_strip_all_tags( $errors );
			}
		}

		public function log() {
			return implode( "\n", $this->lines );
		}
	}
}
