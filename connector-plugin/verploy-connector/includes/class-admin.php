<?php
/**
 * WordPress admin settings page for the Verploy Connector.
 * Shown under Settings → Verploy.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Verploy_Admin {

	public static function init(): void {
		add_action( 'admin_menu',    [ __CLASS__, 'add_menu' ] );
		add_action( 'admin_init',    [ __CLASS__, 'register_settings' ] );
		add_action( 'admin_notices', [ __CLASS__, 'connection_notice' ] );
	}

	// ── Menu ─────────────────────────────────────────────────────────────────

	public static function add_menu(): void {
		add_options_page(
			__( 'Verploy Connector', 'verploy-connector' ),
			__( 'Verploy', 'verploy-connector' ),
			'manage_options',
			'verploy-connector',
			[ __CLASS__, 'settings_page' ]
		);
	}

	// ── Settings ─────────────────────────────────────────────────────────────

	public static function register_settings(): void {
		register_setting( 'verploy_settings', 'verploy_api_key', [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		] );
	}

	// ── Admin notice ─────────────────────────────────────────────────────────

	public static function connection_notice(): void {
		$api_key = get_option( 'verploy_api_key' );
		if ( $api_key ) return;

		$settings_url = admin_url( 'options-general.php?page=verploy-connector' );
		printf(
			'<div class="notice notice-warning"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'Verploy Connector is installed but not connected.', 'verploy-connector' ),
			esc_url( $settings_url ),
			esc_html__( 'Connect now →', 'verploy-connector' )
		);
	}

	// ── Settings page ────────────────────────────────────────────────────────

	public static function settings_page(): void {
		$api_key      = get_option( 'verploy_api_key', '' );
		$heartbeat    = get_option( 'verploy_last_heartbeat', null );
		$connected    = ! empty( $api_key );

		// Handle test connection
		$test_result = null;
		if ( isset( $_POST['verploy_test_connection'] ) && $connected ) {
			check_admin_referer( 'verploy_test' );
			$client      = new Verploy_API_Client( $api_key );
			$response    = $client->get( '/sites/ping' );
			$test_result = is_wp_error( $response )
				? [ 'ok' => false, 'message' => $response->get_error_message() ]
				: [ 'ok' => true,  'message' => __( 'Connected successfully.', 'verploy-connector' ) ];
		}

		// Handle manual heartbeat
		$heartbeat_sent = false;
		if ( isset( $_POST['verploy_send_heartbeat'] ) && $connected ) {
			check_admin_referer( 'verploy_heartbeat_now' );
			Verploy_Heartbeat::send();
			$heartbeat      = get_option( 'verploy_last_heartbeat', null );
			$heartbeat_sent = true;
		}
		?>
		<div class="wrap">
			<h1 style="display:flex;align-items:center;gap:10px;">
				<svg width="24" height="24" viewBox="0 0 48 48" fill="none">
					<rect width="48" height="48" rx="10" fill="#22D98A" fill-opacity="0.14"/>
					<path d="M11 26 L20 36 L38 14" stroke="#22D98A" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
					<path d="M32 14 L38 14 L38 20" stroke="#22D98A" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				<?php esc_html_e( 'Verploy Connector', 'verploy-connector' ); ?>
			</h1>

			<?php if ( $heartbeat_sent ) : ?>
				<div class="notice notice-success is-dismissible">
					<p><?php esc_html_e( 'Heartbeat verstuurd naar Verploy.', 'verploy-connector' ); ?></p>
				</div>
			<?php endif; ?>
			<?php if ( $test_result ) : ?>
				<div class="notice notice-<?php echo $test_result['ok'] ? 'success' : 'error'; ?> is-dismissible">
					<p><?php echo esc_html( $test_result['message'] ); ?></p>
				</div>
			<?php endif; ?>

			<!-- Status card -->
			<div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:20px 24px;margin:20px 0;max-width:640px;">
				<h2 style="margin:0 0 16px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#666;">
					<?php esc_html_e( 'Connection status', 'verploy-connector' ); ?>
				</h2>
				<?php if ( $connected ) : ?>
					<p style="display:flex;align-items:center;gap:8px;color:#15803d;font-weight:600;">
						<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
						<?php esc_html_e( 'Connected to Verploy', 'verploy-connector' ); ?>
					</p>
					<?php if ( $heartbeat ) : ?>
						<p style="color:#666;font-size:13px;margin-top:8px;">
							<?php printf(
								esc_html__( 'Last heartbeat: %s', 'verploy-connector' ),
								esc_html( $heartbeat['timestamp'] )
							); ?>
							<?php if ( ! $heartbeat['success'] ) : ?>
								<span style="color:#dc2626;"> — <?php echo esc_html( $heartbeat['error'] ); ?></span>
							<?php endif; ?>
						</p>
					<?php endif; ?>
				<?php else : ?>
					<p style="display:flex;align-items:center;gap:8px;color:#92400e;font-weight:600;">
						<span style="width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>
						<?php esc_html_e( 'Not connected — enter your API key below', 'verploy-connector' ); ?>
					</p>
				<?php endif; ?>
			</div>

			<form method="post" action="options.php" style="max-width:640px;">
				<?php settings_fields( 'verploy_settings' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">
							<label for="verploy_api_key"><?php esc_html_e( 'API Key', 'verploy-connector' ); ?></label>
						</th>
						<td>
							<input
								name="verploy_api_key"
								id="verploy_api_key"
								type="password"
								value="<?php echo esc_attr( $api_key ); ?>"
								class="regular-text"
								autocomplete="off"
								placeholder="vp_live_••••••••"
							/>
							<p class="description">
								<?php printf(
									wp_kses(
										__( 'Find your API key in your <a href="%s" target="_blank">Verploy dashboard</a> under Settings → Sites → Add site.', 'verploy-connector' ),
										[ 'a' => [ 'href' => [], 'target' => [] ] ]
									),
									esc_url( 'https://app.verploy.com/settings/sites' )
								); ?>
							</p>
						</td>
					</tr>
				</table>
				<?php submit_button( __( 'Save API Key', 'verploy-connector' ) ); ?>
			</form>

			<?php if ( $connected ) : ?>
				<div style="display:flex;gap:10px;margin-top:0;max-width:640px;flex-wrap:wrap;">
					<form method="post">
						<?php wp_nonce_field( 'verploy_test' ); ?>
						<input type="hidden" name="verploy_test_connection" value="1">
						<button type="submit" class="button button-secondary">
							<?php esc_html_e( 'Test connection', 'verploy-connector' ); ?>
						</button>
					</form>
					<form method="post">
						<?php wp_nonce_field( 'verploy_heartbeat_now' ); ?>
						<input type="hidden" name="verploy_send_heartbeat" value="1">
						<button type="submit" class="button button-primary">
							&#8635; <?php esc_html_e( 'Nu versturen naar Verploy', 'verploy-connector' ); ?>
						</button>
					</form>
				</div>
			<?php endif; ?>

			<hr style="margin:32px 0;">
			<p style="color:#666;font-size:13px;">
				<?php printf(
					wp_kses(
						__( 'Verploy Connector v%s · <a href="%s" target="_blank">Documentation</a> · <a href="%s" target="_blank">Support</a>', 'verploy-connector' ),
						[ 'a' => [ 'href' => [], 'target' => [] ] ]
					),
					esc_html( VERPLOY_VERSION ),
					esc_url( 'https://verploy.com/docs/connector' ),
					esc_url( 'https://verploy.com/support' )
				); ?>
			</p>
		</div>
		<?php
	}
}
