<?php
/**
 * Upgrader skin that captures output instead of printing it.
 * Loaded on demand by Verploy_Job_Runner::load_upgrade_libs().
 */

if ( ! defined( 'ABSPATH' ) ) exit;

if ( class_exists( 'Verploy_Silent_Upgrader_Skin' ) ) return;

class Verploy_Silent_Upgrader_Skin extends WP_Upgrader_Skin {

	private array $messages = [];

	public function feedback( $string, ...$args ): void {
		if ( ! empty( $string ) ) {
			$this->messages[] = is_string( $string ) ? $string : (string) $string;
		}
	}

	public function header(): void {}
	public function footer(): void {}
	public function error( $errors ): void {
		if ( is_wp_error( $errors ) ) {
			foreach ( $errors->get_error_messages() as $msg ) {
				$this->messages[] = 'Fout: ' . $msg;
			}
		} else {
			$this->messages[] = 'Fout: ' . (string) $errors;
		}
	}

	public function get_log(): string {
		return implode( "\n", $this->messages );
	}
}
