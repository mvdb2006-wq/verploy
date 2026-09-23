<?php
/**
 * Bestanden kopiëren in stukken (manifest + cursor), mappen verplaatsen en verwijderen.
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Verploy_File_Copier {

	const MAX_FILE_BYTES = 52428800; // 50 MB: grotere bestanden (backups, video) horen niet in staging

	/**
	 * Schrijft een manifest met relatieve paden van alle te kopiëren bestanden.
	 *
	 * @param array<string,string> $roots   Bron-map => doel-map.
	 * @param string[]             $exclude Absolute paden (mappen of bestanden) die worden overgeslagen.
	 * @return int Aantal bestanden.
	 */
	public static function build_manifest( array $roots, array $exclude, $manifest_path ) {
		$exclude = array_map( array( __CLASS__, 'norm' ), $exclude );
		$fh      = fopen( $manifest_path, 'wb' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		$count   = 0;
		foreach ( $roots as $src => $dst ) {
			$src = self::norm( $src );
			if ( is_file( $src ) ) {
				fwrite( $fh, $src . "\t" . $dst . "\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
				$count++;
				continue;
			}
			if ( ! is_dir( $src ) ) {
				continue;
			}
			$it = new RecursiveIteratorIterator(
				new RecursiveCallbackFilterIterator(
					new RecursiveDirectoryIterator( $src, FilesystemIterator::SKIP_DOTS ),
					function ( $file ) use ( $exclude ) {
						$path = Verploy_File_Copier::norm( $file->getPathname() );
						foreach ( $exclude as $ex ) {
							if ( $path === $ex || 0 === strpos( $path, $ex . '/' ) ) {
								return false;
							}
						}
						return ! $file->isLink();
					}
				)
			);
			foreach ( $it as $file ) {
				if ( $file->isFile() && $file->getSize() <= self::MAX_FILE_BYTES ) {
					$rel = substr( self::norm( $file->getPathname() ), strlen( $src ) );
					fwrite( $fh, $file->getPathname() . "\t" . rtrim( $dst, '/' ) . $rel . "\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
					$count++;
				}
			}
		}
		fclose( $fh ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		return $count;
	}

	/**
	 * Kopieert vanaf regel $cursor tot het budget op is.
	 *
	 * @return int Nieuwe cursor.
	 */
	public static function copy_step( $manifest_path, $cursor, Verploy_Budget $budget ) {
		$file = new SplFileObject( $manifest_path );
		$file->seek( $cursor );
		while ( ! $file->eof() ) {
			$line = rtrim( (string) $file->current(), "\n" );
			if ( '' === $line ) {
				$file->next();
				continue;
			}
			{
				list( $src, $dst ) = explode( "\t", $line, 2 );
				$dir = dirname( $dst );
				if ( ! is_dir( $dir ) && ! wp_mkdir_p( $dir ) ) {
					throw new RuntimeException( 'mkdir_failed:' . $dir );
				}
				if ( ! @copy( $src, $dst ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors
					throw new RuntimeException( 'copy_failed:' . $src );
				}
			}
			$cursor++;
			$file->next();
			if ( 0 === $cursor % 50 && $budget->expired() ) {
				break;
			}
		}
		return $cursor;
	}

	public static function norm( $path ) {
		return rtrim( str_replace( '\\', '/', (string) $path ), '/' );
	}

	/** Verwijdert een map recursief (alleen binnen WP_CONTENT_DIR, als vangnet). */
	public static function delete_tree( $dir ) {
		$dir = self::norm( $dir );
		if ( '' === $dir || ! is_dir( $dir ) || 0 !== strpos( $dir, self::norm( WP_CONTENT_DIR ) . '/' ) ) {
			return;
		}
		$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::CHILD_FIRST );
		foreach ( $it as $f ) {
			$f->isDir() && ! $f->isLink() ? @rmdir( $f->getPathname() ) : @unlink( $f->getPathname() ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
		@rmdir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	}

	/** Kopieert een map of bestand in één keer (voor kleine plugin-/themamappen). */
	public static function copy_tree( $src, $dst ) {
		$src = self::norm( $src );
		if ( is_file( $src ) ) {
			wp_mkdir_p( dirname( $dst ) );
			return copy( $src, $dst );
		}
		$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $src, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::SELF_FIRST );
		wp_mkdir_p( $dst );
		foreach ( $it as $f ) {
			$target = rtrim( $dst, '/' ) . substr( self::norm( $f->getPathname() ), strlen( $src ) );
			if ( $f->isDir() ) {
				wp_mkdir_p( $target );
			} elseif ( ! copy( $f->getPathname(), $target ) ) {
				return false;
			}
		}
		return true;
	}
}
