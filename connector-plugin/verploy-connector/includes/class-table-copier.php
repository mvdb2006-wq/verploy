<?php
/**
 * Kopieert en herstelt databasetabellen per prefix, in stukken en hervatbaar.
 * Werkt binnen dezelfde database (CREATE TABLE LIKE + INSERT … SELECT).
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Deze klasse kopieert en hernoemt complete databasetabellen (staging en back-up). Dat kan niet via de
// WordPress-API's; tabelnamen komen uitsluitend uit information_schema of uit onze eigen prefix en worden
// met quote() tussen backticks gezet (backticks in namen verdubbeld). Caching is hier niet van toepassing.
// phpcs:disable WordPress.DB.DirectDatabaseQuery, PluginCheck.Security.DirectDB.UnescapedDBParameter, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
class Verploy_Table_Copier {

	const ROWS_PER_CHUNK = 2000;

	/** Prefixen die Verploy zelf gebruikt en die nooit meegekopieerd worden. */
	const OWN_PREFIXES = array( 'vpst', 'vpbk', 'vpdel' );

	/**
	 * Tabellen die bij deze WordPress-installatie horen (exacte prefix-match).
	 *
	 * @param string $prefix Bijv. 'wp_'.
	 * @return string[]
	 */
	public static function tables_with_prefix( $prefix ) {
		global $wpdb;
		// Exacte prefix-vergelijking i.p.v. LIKE: escaping van '_' verschilt per database-engine.
		$tables = $wpdb->get_col( $wpdb->prepare( 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LEFT(TABLE_NAME, %d) = %s', strlen( $prefix ), $prefix ) );
		$out    = array();
		foreach ( (array) $tables as $t ) {
			foreach ( self::OWN_PREFIXES as $own ) {
				if ( 0 === strpos( $t, $own ) && 0 !== strpos( $prefix, $own ) ) {
					continue 2;
				}
			}
			$out[] = $t;
		}
		sort( $out );
		return $out;
	}

	public static function quote( $table ) {
		return '`' . str_replace( '`', '``', $table ) . '`';
	}

	/** Eén-koloms numerieke primaire sleutel (voor snelle keyset-paginering), anders null. */
	private static function numeric_pk( $table ) {
		global $wpdb;
		$keys = $wpdb->get_results( 'SHOW KEYS FROM ' . self::quote( $table ) . " WHERE Key_name = 'PRIMARY'", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL
		if ( ! is_array( $keys ) || 1 !== count( $keys ) ) {
			return null;
		}
		$col  = $keys[0]['Column_name'];
		$type = $wpdb->get_var( $wpdb->prepare( 'SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s', $table, $col ) );
		return in_array( strtolower( (string) $type ), array( 'int', 'bigint', 'mediumint', 'smallint', 'tinyint' ), true ) ? $col : null;
	}

	/**
	 * Terugval als CREATE TABLE … LIKE niet werkt (sommige MySQL-compatibele databases nemen dan de
	 * prefixlengte van indexen op tekstkolommen niet over, zoals bij WooCommerce' wc_orders_meta):
	 * dezelfde definitie via SHOW CREATE TABLE, met alleen de tabelnaam vervangen.
	 */
	private static function create_from_definition( $src, $dst ) {
		global $wpdb;
		$row = $wpdb->get_row( 'SHOW CREATE TABLE ' . self::quote( $src ), ARRAY_N ); // phpcs:ignore WordPress.DB.PreparedSQL, WordPress.DB.DirectDatabaseQuery
		if ( ! is_array( $row ) || empty( $row[1] ) ) {
			return false;
		}
		$ddl = preg_replace( '/^CREATE TABLE `[^`]+`/', 'CREATE TABLE ' . self::quote( $dst ), (string) $row[1], 1, $count );
		if ( 1 !== $count ) {
			return false;
		}
		$wpdb->query( 'DROP TABLE IF EXISTS ' . self::quote( $dst ) ); // phpcs:ignore WordPress.DB.PreparedSQL, WordPress.DB.DirectDatabaseQuery
		return false !== $wpdb->query( $ddl ); // phpcs:ignore WordPress.DB.PreparedSQL, WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * Kopieert tabellen van $from_prefix naar $to_prefix. $state wordt bijgewerkt en
	 * moet tussen verzoeken bewaard worden; opnieuw aanroepen met dezelfde state hervat.
	 *
	 * @param array          $state  ['tables' => [...], 'index' => int, 'last' => mixed, 'offset' => int].
	 * @param Verploy_Budget $budget Tijdsbudget.
	 * @return bool True als alles gekopieerd is.
	 */
	public static function copy_step( $from_prefix, $to_prefix, array &$state, Verploy_Budget $budget ) {
		global $wpdb;
		if ( ! isset( $state['tables'] ) ) {
			$state = array( 'tables' => self::tables_with_prefix( $from_prefix ), 'index' => 0, 'last' => null, 'offset' => 0, 'created' => false );
		}
		while ( $state['index'] < count( $state['tables'] ) ) {
			$src = $state['tables'][ $state['index'] ];
			$dst = $to_prefix . substr( $src, strlen( $from_prefix ) );
			if ( ! $state['created'] ) {
				$wpdb->query( 'DROP TABLE IF EXISTS ' . self::quote( $dst ) ); // phpcs:ignore WordPress.DB.PreparedSQL
				if ( false === $wpdb->query( 'CREATE TABLE ' . self::quote( $dst ) . ' LIKE ' . self::quote( $src ) ) && ! self::create_from_definition( $src, $dst ) ) { // phpcs:ignore WordPress.DB.PreparedSQL
					throw new RuntimeException( esc_html( 'create_table_failed:' . $dst . ':' . $wpdb->last_error ) );
				}
				$state['created'] = true;
				$state['last']    = null;
				$state['offset']  = 0;
			}
			$pk = self::numeric_pk( $src );
			while ( true ) {
				if ( $budget->expired() ) {
					return false;
				}
				if ( $pk ) {
					$where = null === $state['last'] ? '' : $wpdb->prepare( ' WHERE ' . self::quote( $pk ) . ' > %d', $state['last'] ); // phpcs:ignore WordPress.DB.PreparedSQL
					$max   = $wpdb->get_var( 'SELECT MAX(' . self::quote( $pk ) . ') FROM (SELECT ' . self::quote( $pk ) . ' FROM ' . self::quote( $src ) . $where . ' ORDER BY ' . self::quote( $pk ) . ' LIMIT ' . self::ROWS_PER_CHUNK . ') AS c' ); // phpcs:ignore WordPress.DB.PreparedSQL
					if ( null === $max ) {
						break;
					}
					$range = ( null === $state['last'] ? '' : $wpdb->prepare( self::quote( $pk ) . ' > %d AND ', $state['last'] ) ) . $wpdb->prepare( self::quote( $pk ) . ' <= %d', $max ); // phpcs:ignore WordPress.DB.PreparedSQL
					$ok    = $wpdb->query( 'INSERT INTO ' . self::quote( $dst ) . ' SELECT * FROM ' . self::quote( $src ) . ' WHERE ' . $range ); // phpcs:ignore WordPress.DB.PreparedSQL
					$state['last'] = (int) $max;
				} else {
					$ok = $wpdb->query( 'INSERT INTO ' . self::quote( $dst ) . ' SELECT * FROM ' . self::quote( $src ) . ' LIMIT ' . self::ROWS_PER_CHUNK . ' OFFSET ' . (int) $state['offset'] ); // phpcs:ignore WordPress.DB.PreparedSQL
					if ( 0 === (int) $ok ) {
						break;
					}
					$state['offset'] += self::ROWS_PER_CHUNK;
				}
				if ( false === $ok ) {
					throw new RuntimeException( esc_html( 'copy_rows_failed:' . $dst . ':' . $wpdb->last_error ) );
				}
			}
			$state['index']++;
			$state['created'] = false;
		}
		return true;
	}

	/**
	 * Zet tabellen uit een backup-prefix terug: per tabel een atomaire RENAME.
	 * Tabellen die na de backup zijn aangemaakt (niet in $backup_tables) worden verwijderd.
	 *
	 * @param string[] $backup_tables Tabelnamen (met live-prefix) zoals ze bij de backup bestonden.
	 */
	public static function restore( $live_prefix, $backup_prefix, array $backup_tables ) {
		global $wpdb;
		$trash = 'vpdel' . substr( md5( $backup_prefix ), 0, 6 ) . '_';
		foreach ( $backup_tables as $live ) {
			$suffix = substr( $live, strlen( $live_prefix ) );
			$bk     = $backup_prefix . $suffix;
			if ( ! self::exists( $bk ) ) {
				continue; // al teruggezet (idempotent)
			}
			$exists = self::exists( $live );
			if ( $exists ) {
				$wpdb->query( 'DROP TABLE IF EXISTS ' . self::quote( $trash . $suffix ) ); // phpcs:ignore WordPress.DB.PreparedSQL
				$ok = $wpdb->query( 'RENAME TABLE ' . self::quote( $live ) . ' TO ' . self::quote( $trash . $suffix ) . ', ' . self::quote( $bk ) . ' TO ' . self::quote( $live ) ); // phpcs:ignore WordPress.DB.PreparedSQL
			} else {
				$ok = $wpdb->query( 'RENAME TABLE ' . self::quote( $bk ) . ' TO ' . self::quote( $live ) ); // phpcs:ignore WordPress.DB.PreparedSQL
			}
			if ( false === $ok ) {
				throw new RuntimeException( esc_html( 'restore_failed:' . $live . ':' . $wpdb->last_error ) );
			}
			$wpdb->query( 'DROP TABLE IF EXISTS ' . self::quote( $trash . $suffix ) ); // phpcs:ignore WordPress.DB.PreparedSQL
		}
		foreach ( self::tables_with_prefix( $live_prefix ) as $t ) {
			if ( ! in_array( $t, $backup_tables, true ) ) {
				$wpdb->query( 'DROP TABLE IF EXISTS ' . self::quote( $t ) ); // phpcs:ignore WordPress.DB.PreparedSQL
			}
		}
		wp_cache_flush();
	}

	public static function exists( $table ) {
		global $wpdb;
		return (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s', $table ) );
	}

	public static function drop_prefix( $prefix ) {
		global $wpdb;
		foreach ( self::tables_with_prefix( $prefix ) as $t ) {
			$wpdb->query( 'DROP TABLE IF EXISTS ' . self::quote( $t ) ); // phpcs:ignore WordPress.DB.PreparedSQL
		}
	}
}
