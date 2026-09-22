<?php
/**
 * Plugin Name: Verploy Connector
 * Plugin URI:  https://verploy.com
 * Description: Verbindt je WordPress-site met Verploy voor monitoring en beheer.
 * Version:     1.0.0
 * Author:      Verploy
 * Author URI:  https://verploy.com
 * License:     GPL v2 or later
 * Text Domain: verploy-connector
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'VERPLOY_VERSION',       '1.0.0' );
define( 'VERPLOY_API_URL',       'https://app.verploy.com/api/v1/ping' );
define( 'VERPLOY_OPTION_KEY',    'verploy_api_key' );
define( 'VERPLOY_CRON_HOOK',     'verploy_hourly_ping' );

// ── Activation / Deactivation ───────────────────────────────────────────────

register_activation_hook( __FILE__, function () {
    if ( ! wp_next_scheduled( VERPLOY_CRON_HOOK ) ) {
        wp_schedule_event( time(), 'hourly', VERPLOY_CRON_HOOK );
    }
} );

register_deactivation_hook( __FILE__, function () {
    $ts = wp_next_scheduled( VERPLOY_CRON_HOOK );
    if ( $ts ) wp_unschedule_event( $ts, VERPLOY_CRON_HOOK );
} );

// ── Cron ping ───────────────────────────────────────────────────────────────

add_action( VERPLOY_CRON_HOOK, 'verploy_send_ping' );

function verploy_send_ping() {
    $api_key = get_option( VERPLOY_OPTION_KEY, '' );
    if ( empty( $api_key ) ) return;

    global $wp_version;

    // Collect installed plugins
    if ( ! function_exists( 'get_plugins' ) ) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    $active  = (array) get_option( 'active_plugins', [] );
    $plugins = [];
    foreach ( get_plugins() as $file => $data ) {
        $plugins[] = [
            'slug'    => dirname( $file ) === '.' ? basename( $file, '.php' ) : dirname( $file ),
            'name'    => $data['Name'],
            'version' => $data['Version'],
            'active'  => in_array( $file, $active, true ),
        ];
    }

    // Active theme
    $theme = wp_get_theme();

    $payload = [
        'api_key'     => $api_key,
        'site_url'    => home_url(),
        'wp_version'  => $wp_version,
        'php_version' => PHP_VERSION,
        'plugins'     => $plugins,
        'theme'       => [
            'name'    => $theme->get( 'Name' ),
            'version' => $theme->get( 'Version' ),
        ],
    ];

    $response = wp_remote_post( VERPLOY_API_URL, [
        'headers'     => [ 'Content-Type' => 'application/json' ],
        'body'        => wp_json_encode( $payload ),
        'timeout'     => 15,
        'data_format' => 'body',
    ] );

    $code = is_wp_error( $response ) ? 0 : wp_remote_retrieve_response_code( $response );
    update_option( 'verploy_last_ping', current_time( 'mysql' ) );
    update_option( 'verploy_last_ping_status', $code === 200 ? 'ok' : 'error' );
}

// ── Admin menu ───────────────────────────────────────────────────────────────

add_action( 'admin_menu', function () {
    add_options_page( 'Verploy', 'Verploy', 'manage_options', 'verploy', 'verploy_settings_page' );
} );

add_action( 'admin_init', function () {
    register_setting( 'verploy_settings', VERPLOY_OPTION_KEY, [
        'sanitize_callback' => 'sanitize_text_field',
    ] );
} );

function verploy_settings_page() {
    $api_key = get_option( VERPLOY_OPTION_KEY, '' );
    $saved   = ! empty( $api_key );

    // Manual ping
    if ( $saved && isset( $_POST['verploy_ping_now'] ) && check_admin_referer( 'verploy_ping_now' ) ) {
        verploy_send_ping();
        echo '<div class="notice notice-success is-dismissible"><p><strong>Ping verzonden!</strong> De site verschijnt binnen enkele seconden als Online in je Verploy-dashboard.</p></div>';
    }

    $last_ping   = get_option( 'verploy_last_ping', '' );
    $last_status = get_option( 'verploy_last_ping_status', '' );
    $next_ping   = wp_next_scheduled( VERPLOY_CRON_HOOK );
    ?>
    <div class="wrap">
        <h1 style="display:flex;align-items:center;gap:8px">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            Verploy Connector
        </h1>

        <form method="post" action="options.php" style="max-width:600px">
            <?php settings_fields( 'verploy_settings' ); ?>
            <table class="form-table">
                <tr>
                    <th><label for="<?php echo VERPLOY_OPTION_KEY; ?>">API-sleutel</label></th>
                    <td>
                        <input type="text"
                               id="<?php echo VERPLOY_OPTION_KEY; ?>"
                               name="<?php echo VERPLOY_OPTION_KEY; ?>"
                               value="<?php echo esc_attr( $api_key ); ?>"
                               class="regular-text code"
                               placeholder="vp_…"
                               autocomplete="off">
                        <p class="description">Te vinden in <a href="https://app.verploy.com/settings" target="_blank">Verploy → Instellingen → Sites &amp; API-sleutels</a>.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button( 'Opslaan' ); ?>
        </form>

        <?php if ( $saved ) : ?>
        <hr>
        <h2>Verbindingsstatus</h2>
        <table class="form-table" style="max-width:600px">
            <tr>
                <th>API-sleutel</th>
                <td><span style="color:#00a32a">✓ Ingesteld</span></td>
            </tr>
            <tr>
                <th>Laatste ping</th>
                <td>
                    <?php if ( $last_ping ) : ?>
                        <?php echo esc_html( $last_ping ); ?>
                        <?php if ( $last_status === 'ok' ) : ?>
                            <span style="color:#00a32a;margin-left:8px">✓ Succesvol</span>
                        <?php elseif ( $last_status === 'error' ) : ?>
                            <span style="color:#d63638;margin-left:8px">✗ Mislukt</span>
                        <?php endif; ?>
                    <?php else : ?>
                        <em>Nog geen ping verzonden</em>
                    <?php endif; ?>
                </td>
            </tr>
            <tr>
                <th>Volgende automatische ping</th>
                <td><?php echo $next_ping ? esc_html( wp_date( 'd-m-Y H:i', $next_ping ) ) : '—'; ?></td>
            </tr>
        </table>

        <form method="post" style="margin-top:16px">
            <?php wp_nonce_field( 'verploy_ping_now' ); ?>
            <input type="hidden" name="verploy_ping_now" value="1">
            <?php submit_button( 'Nu verbinden (stuur ping)', 'secondary', 'submit', false ); ?>
        </form>
        <?php endif; ?>
    </div>
    <?php
}
