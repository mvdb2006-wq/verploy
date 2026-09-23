/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },

  // Redirect oude statische ZIP-URL naar de API route die correcte binary headers zet
  // (voorkomt PCLZIP_ERR_BAD_FORMAT op sites met gecachede download_url)
  async redirects() {
    return [
      {
        source: '/downloads/verploy-connector-:version.zip',
        destination: '/api/v1/plugin/download',
        permanent: false, // 302 zodat WordPress de redirect volgt
      },
    ]
  },
}

export default nextConfig
