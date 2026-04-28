import type { RegistryMetricsConfig } from '../types';

type RouteMetric = {
  count: number;
  lastSeenAt: string;
};

export class MetricsService {
  private readonly startedAt = new Date();
  private readonly routes = new Map<string, RouteMetric>();

  constructor(private readonly config: RegistryMetricsConfig) {}

  recordRequest(method: string, url: string) {
    if (!this.config.enabled) return;
    const key = `${method} ${url.split('?')[0]}`;
    const previous = this.routes.get(key);
    this.routes.set(key, {
      count: (previous?.count || 0) + 1,
      lastSeenAt: new Date().toISOString()
    });
  }

  getMetrics() {
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      routes: Object.fromEntries(this.routes)
    };
  }
}
