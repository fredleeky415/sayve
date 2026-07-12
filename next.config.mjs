const sensitiveHeaders = [
  { key: "Cache-Control", value: "no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: sensitiveHeaders
      },
      {
        source: "/admin/:path*",
        headers: sensitiveHeaders
      },
      {
        source: "/admin",
        headers: sensitiveHeaders
      },
      {
        source: "/invite",
        headers: sensitiveHeaders
      }
    ];
  }
};

export default nextConfig;
