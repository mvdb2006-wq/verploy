<?php
/**
 * Instellingenpagina: koppelen met code, status, verbinding testen, ontkoppelen.
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_Admin {

	const PAGE = 'verploy-connector';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_post_verploy_pair', array( __CLASS__, 'handle_pair' ) );
		add_action( 'admin_post_verploy_test', array( __CLASS__, 'handle_test' ) );
		add_action( 'admin_post_verploy_disconnect', array( __CLASS__, 'handle_disconnect' ) );
		add_action( 'admin_notices', array( __CLASS__, 'not_connected_notice' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( VERPLOY_PLUGIN_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function menu() {
		add_options_page( 'Verploy', 'Verploy', 'manage_options', self::PAGE, array( __CLASS__, 'render' ) );
	}

	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( self::url() ) . '">' . esc_html__( 'Instellingen', 'verploy-connector' ) . '</a>' );
		return $links;
	}

	private static function url( $args = array() ) {
		return add_query_arg( array_merge( array( 'page' => self::PAGE ), $args ), admin_url( 'options-general.php' ) );
	}

	public static function not_connected_notice() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( Verploy_Connection::is_connected() || ! current_user_can( 'manage_options' ) || ( $screen && 'settings_page_' . self::PAGE === $screen->id ) ) {
			return;
		}
		printf(
			'<div class="notice notice-warning"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'Verploy Connector is geïnstalleerd maar nog niet gekoppeld.', 'verploy-connector' ),
			esc_url( self::url() ),
			esc_html__( 'Nu koppelen', 'verploy-connector' )
		);
	}

	private static function guard( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Je hebt geen toestemming voor deze actie.', 'verploy-connector' ), 403 );
		}
		check_admin_referer( $action );
	}

	private static function done( $type, $message ) {
		set_transient( 'verploy_notice_' . get_current_user_id(), array( 'type' => $type, 'message' => $message ), 60 );
		wp_safe_redirect( self::url() );
		exit;
	}

	public static function handle_pair() {
		self::guard( 'verploy_pair' );
		$code   = isset( $_POST['verploy_code'] ) ? sanitize_text_field( wp_unslash( $_POST['verploy_code'] ) ) : '';
		$result = Verploy_Connection::pair( $code );
		if ( is_wp_error( $result ) ) {
			self::done( 'error', $result->get_error_message() );
		}
		$beat = Verploy_Heartbeat::send();
		self::done(
			is_wp_error( $beat ) ? 'warning' : 'success',
			is_wp_error( $beat )
				/* translators: %s: foutmelding. */
				? sprintf( __( 'Gekoppeld, maar de eerste heartbeat mislukte: %s', 'verploy-connector' ), $beat->get_error_message() )
				: __( 'Gekoppeld. De site staat nu in je Verploy-dashboard.', 'verploy-connector' )
		);
	}

	public static function handle_test() {
		self::guard( 'verploy_test' );
		$beat = Verploy_Heartbeat::send();
		self::done( is_wp_error( $beat ) ? 'error' : 'success', is_wp_error( $beat ) ? $beat->get_error_message() : __( 'Verbinding werkt. Gegevens zijn verstuurd.', 'verploy-connector' ) );
	}

	public static function handle_disconnect() {
		self::guard( 'verploy_disconnect' );
		Verploy_Connection::disconnect();
		self::done( 'success', __( 'Ontkoppeld. Deze site stuurt geen gegevens meer naar Verploy.', 'verploy-connector' ) );
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$notice = get_transient( 'verploy_notice_' . get_current_user_id() );
		delete_transient( 'verploy_notice_' . get_current_user_id() );
		$last = get_option( Verploy_Heartbeat::OPT_LAST );
		?>
		<div class="wrap">
			<h1>Verploy</h1>
			<?php if ( is_array( $notice ) ) : ?>
				<div class="notice notice-<?php echo esc_attr( $notice['type'] ); ?>"><p><?php echo esc_html( $notice['message'] ); ?></p></div>
			<?php endif; ?>

			<?php if ( Verploy_Connection::is_connected() ) : ?>
				<p><strong><?php esc_html_e( 'Status:', 'verploy-connector' ); ?></strong> <?php esc_html_e( 'Gekoppeld', 'verploy-connector' ); ?></p>
				<?php if ( is_array( $last ) ) : ?>
					<p>
						<?php
						/* translators: %s: datum en tijd. */
						printf( esc_html__( 'Laatste heartbeat: %s', 'verploy-connector' ), esc_html( wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), (int) $last['time'] ) ) );
						echo ' — ';
						echo $last['success'] ? esc_html__( 'geslaagd', 'verploy-connector' ) : esc_html( (string) $last['error'] );
						?>
					</p>
				<?php endif; ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block;margin-right:8px">
					<input type="hidden" name="action" value="verploy_test">
					<?php wp_nonce_field( 'verploy_test' ); ?>
					<?php submit_button( __( 'Verbinding testen', 'verploy-connector' ), 'secondary', 'verploy_test_submit', false ); ?>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block">
					<input type="hidden" name="action" value="verploy_disconnect">
					<?php wp_nonce_field( 'verploy_disconnect' ); ?>
					<?php submit_button( __( 'Ontkoppelen', 'verploy-connector' ), 'delete', 'verploy_disconnect_submit', false ); ?>
				</form>
				<h2><?php esc_html_e( 'Opnieuw koppelen', 'verploy-connector' ); ?></h2>
			<?php else : ?>
				<p><?php esc_html_e( 'Maak in je Verploy-dashboard een koppelcode aan (Sites → deze site → Koppelcode maken) en plak hem hieronder.', 'verploy-connector' ); ?></p>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="verploy_pair">
				<?php wp_nonce_field( 'verploy_pair' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="verploy_code"><?php esc_html_e( 'Koppelcode', 'verploy-connector' ); ?></label></th>
						<td><input name="verploy_code" id="verploy_code" type="text" class="regular-text code" autocomplete="off" spellcheck="false" maxlength="20" required></td>
					</tr>
				</table>
				<?php submit_button( __( 'Koppelen', 'verploy-connector' ), 'primary', 'verploy_pair_submit' ); ?>
			</form>
		</div>
		<?php
	}
}
