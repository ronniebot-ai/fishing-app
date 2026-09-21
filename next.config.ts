import type { NextConfig } from 'next'

// Nothing to configure yet. The app is installable through src/app/manifest.ts,
// which Next serves and links on its own; there is deliberately no service
// worker, so there is no build step to wire one in.
const nextConfig: NextConfig = {}

export default nextConfig
