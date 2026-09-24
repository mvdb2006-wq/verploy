<?php
/**
 * Richt de lab-WordPress in voor de functionele tests (E2E fase 9.1) met de ECHTE plugins:
 *   • Contact Form 7 met een contactformulier op de pagina "Contact"
 *   • WPForms Lite met een formulier (naam, e-mail, bericht) op de pagina "Offerte"
 *   • WooCommerce met winkel/winkelwagen/afrekenen en één eenvoudig product
 *
 *   php connector-plugin/tests/lab/functional-setup.php <wordpress-map> <site-url> <map-met-zips>
 *
 * lab-reset.php haalt alles weer weg (plugins, pagina's en product), zodat de andere tests een schone lab hebben.
 * De zips zijn de officiële downloads van wordpress.org (contact-form-7.zip, wpforms-lite.zip, woocommerce.zip).
 */
if ( PHP_SAPI !== 'cli' || $argc < 4 ) { fwrite( STDERR, "gebruik: functional-setup.php <wp> <url> <zips>\n" ); exit( 2 ); }
[ , $lab_wp_dir, $lab_url, $zips ] = $argv;
$u = parse_url( $lab_url );
$_SERVER['HTTP_HOST']   = $u['host'] . ( isset( $u['port'] ) ? ':' . $u['port'] : '' );
$_SERVER['REQUEST_URI'] = '/';
define( 'WP_ADMIN', true );
require rtrim( $lab_wp_dir, '/' ) . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
wp_set_current_user( 1 );

$plugins = array( 'contact-form-7' => 'contact-form-7/wp-contact-form-7.php', 'wpforms-lite' => 'wpforms-lite/wpforms.php', 'woocommerce' => 'woocommerce/woocommerce.php' );
foreach ( $plugins as $slug => $file ) {
	if ( ! is_dir( WP_PLUGIN_DIR . '/' . $slug ) ) {
		$zip = new ZipArchive();
		if ( true !== $zip->open( rtrim( $zips, '/' ) . "/$slug.zip" ) ) { fwrite( STDERR, "zip ontbreekt: $slug\n" ); exit( 1 ); }
		$zip->extractTo( WP_PLUGIN_DIR );
		$zip->close();
	}
}
wp_clean_plugins_cache( true );
foreach ( $plugins as $slug => $file ) {
	$r = activate_plugin( $file, '', false, false );
	if ( is_wp_error( $r ) ) { fwrite( STDERR, "activeren mislukt: $slug: " . $r->get_error_message() . "\n" ); exit( 1 ); }
}

$mark = function ( $id ) { update_post_meta( $id, '_verploy_lab_functional', 1 ); return $id; };
$page = function ( $title, $content ) use ( $mark ) {
	return $mark( wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => $title, 'post_content' => $content ) ) );
};

// Contact Form 7: het standaardsjabloon (naam, e-mail, onderwerp, bericht).
$cf7 = WPCF7_ContactForm::get_template( array( 'title' => 'Verploy lab contact' ) );
$cf7->save();
$mark( $cf7->id() );
$page( 'Contact', '[contact-form-7 id="' . $cf7->id() . '" title="Verploy lab contact"]' );

// WPForms Lite: naam, e-mail en bericht, versturen via AJAX met een bevestigingsbericht.
$wpforms_id = $mark( wp_insert_post( array( 'post_type' => 'wpforms', 'post_status' => 'publish', 'post_title' => 'Verploy lab offerte', 'post_content' => '{}' ) ) );
$form = array(
	'id'       => (string) $wpforms_id,
	'field_id' => 4,
	'fields'   => array(
		'1' => array( 'id' => '1', 'type' => 'name', 'label' => 'Naam', 'format' => 'simple', 'required' => '1', 'size' => 'medium' ),
		'2' => array( 'id' => '2', 'type' => 'email', 'label' => 'E-mail', 'required' => '1', 'size' => 'medium' ),
		'3' => array( 'id' => '3', 'type' => 'textarea', 'label' => 'Bericht', 'required' => '1', 'size' => 'medium' ),
	),
	'settings' => array(
		'form_title' => 'Verploy lab offerte', 'submit_text' => 'Versturen', 'submit_text_processing' => 'Bezig…', 'ajax_submit' => '1',
		'antispam_v3' => '1', 'store_spam_entries' => '0',
		'notification_enable' => '1', 'notifications' => array( '1' => array( 'email' => '{admin_email}', 'subject' => 'Nieuwe offerte', 'message' => '{all_fields}' ) ),
		'confirmations' => array( '1' => array( 'type' => 'message', 'message' => '<p>Bedankt, we nemen contact op.</p>', 'message_scroll' => '1' ) ),
	),
	'meta'     => array( 'template' => 'blank' ),
);
wp_update_post( array( 'ID' => $wpforms_id, 'post_content' => wp_slash( wp_json_encode( $form ) ) ) );
$page( 'Offerte', '[wpforms id="' . $wpforms_id . '"]' );

// WooCommerce: tabellen en winkelpagina's, winkel open (geen "binnenkort"-modus), één product.
WC_Install::install();
WC_Install::create_pages();
update_option( 'woocommerce_coming_soon', 'no' );
update_option( 'woocommerce_store_pages_only', 'no' );
update_option( 'woocommerce_currency', 'EUR' );
$product = new WC_Product_Simple();
$product->set_name( 'Verploy lab product' );
$product->set_regular_price( '12.50' );
$product->set_status( 'publish' );
$product->set_catalog_visibility( 'visible' );
$product->set_stock_status( 'instock' );
$mark( $product->save() );
foreach ( array( 'shop', 'cart', 'checkout', 'myaccount' ) as $wc ) {
	$id = (int) get_option( "woocommerce_{$wc}_page_id" );
	if ( $id ) { $mark( $id ); }
}
// Geen installatiewizards na het activeren (anders komt wp-admin niet op de Verploy-pagina uit).
delete_transient( '_wc_activation_redirect' );
delete_transient( 'wpforms_activation_redirect' );
update_option( 'wpforms_activation_redirect', true );   // WPForms: welkomstpagina uit
update_option( 'woocommerce_onboarding_profile', array( 'skipped' => true ) );
update_option( 'woocommerce_task_list_hidden', 'yes' );
add_filter( 'woocommerce_enable_setup_wizard', '__return_false' );
flush_rewrite_rules();
echo "functionele lab klaar: CF7-formulier {$cf7->id()}, WPForms-formulier $wpforms_id, product {$product->get_id()}\n";
