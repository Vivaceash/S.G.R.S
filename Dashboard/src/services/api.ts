import type {
  BaseResponse,
  FortiDeviceListSummary,
  FortiSystemResourceUsage,
  FortiSystemStatus,
  FortiTrafficDestination,
  FortiDhcpLease,
  DhcpPoolSummary,
  OmniInfrastructureStats,
  OmniDevice,
  OmniNotification,
} from '../types';

export class ApiService {
  private static fortiBase = localStorage.getItem('sgrs_forti_url')
    || import.meta.env.VITE_FORTI_API_URL
    || 'http://localhost:8001/api/v1';
  private static omniBase = localStorage.getItem('sgrs_omni_url')
    || import.meta.env.VITE_OMNI_API_URL
    || 'http://localhost:8000/api/v1';
  private static apiKey = import.meta.env.DEV ? 'admin' : '';

  public static getFortiUrl(): string {
    return this.fortiBase;
  }

  public static getOmniUrl(): string {
    return this.omniBase;
  }

  public static getApiKey(): string {
    return this.apiKey;
  }

  private static validateBaseUrl(value: string, serviceName: string): string {
    let parsed: URL;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new Error(`La URL de ${serviceName} no tiene un formato válido.`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      throw new Error(`La URL de ${serviceName} debe usar HTTP(S) y no incluir credenciales ni fragmentos.`);
    }

    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol === 'http:' && !isLocal) {
      throw new Error(`La URL de ${serviceName} debe usar HTTPS fuera del equipo local.`);
    }
    if (import.meta.env.PROD && parsed.protocol !== 'https:') {
      throw new Error(`La URL de ${serviceName} debe usar HTTPS en una compilación de producción.`);
    }

    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  }

  public static updateConfig(fortiUrl: string, omniUrl: string, key: string) {
    this.fortiBase = this.validateBaseUrl(fortiUrl, 'Fortinet');
    this.omniBase = this.validateBaseUrl(omniUrl, 'OmniVista');
    this.apiKey = key.trim();
    localStorage.setItem('sgrs_forti_url', this.fortiBase);
    localStorage.setItem('sgrs_omni_url', this.omniBase);
    localStorage.removeItem('sgrs_api_key');
  }

  private static async request<T>(url: string, timeoutMs: number = 18000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Tiempo de espera agotado al conectar (${timeoutMs / 1000}s)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- API Fortinet FortiGate (Puerto 8001) ---

  public static async getFortiDevices(status?: 'all' | 'online' | 'offline'): Promise<FortiDeviceListSummary> {
    const query = status ? `?status=${status}` : '';
    const res = await this.request<BaseResponse<FortiDeviceListSummary>>(`${this.fortiBase}/devices${query}`);
    return {
      total_inventory: res.data?.total_inventory ?? res.data?.total_devices ?? 0,
      total_devices: res.data?.total_devices ?? 0,
      online_devices: res.data?.online_devices ?? 0,
      offline_devices: res.data?.offline_devices ?? 0,
      returned_count: res.data?.returned_count ?? (Array.isArray(res.data?.devices) ? res.data.devices.length : 0),
      devices: Array.isArray(res.data?.devices) ? res.data.devices : [],
    };
  }

  public static async getFortiResources(): Promise<FortiSystemResourceUsage> {
    const res = await this.request<BaseResponse<FortiSystemResourceUsage>>(`${this.fortiBase}/system/resources`);
    return res.data;
  }

  public static async getFortiStatus(): Promise<FortiSystemStatus> {
    const res = await this.request<BaseResponse<FortiSystemStatus>>(`${this.fortiBase}/system/status`);
    return res.data;
  }

  public static async getFortiDhcpLeases(): Promise<FortiDhcpLease[]> {
    try {
      const res = await this.request<BaseResponse<FortiDhcpLease[]>>(`${this.fortiBase}/network/dhcp-leases`);
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  public static async getFortiDhcpPools(): Promise<DhcpPoolSummary | null> {
    try {
      const res = await this.request<BaseResponse<DhcpPoolSummary>>(`${this.fortiBase}/network/dhcp-pools`);
      return res.data || null;
    } catch {
      return null;
    }
  }

  public static async getFortiDestinations(): Promise<FortiTrafficDestination[]> {
    try {
      const res = await this.request<BaseResponse<FortiTrafficDestination[]>>(`${this.fortiBase}/traffic/destinations`);
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  // --- API Alcatel OmniVista 2500 (Puerto 8000) ---

  public static async getOmniStats(): Promise<OmniInfrastructureStats> {
    const res = await this.request<BaseResponse<OmniInfrastructureStats>>(`${this.omniBase}/monitoring/infrastructure-stats`);
    return res.data;
  }

  public static async getOmniDevices(): Promise<OmniDevice[]> {
    try {
      const res = await this.request<BaseResponse<unknown>>(`${this.omniBase}/monitoring/devices`);
      if (Array.isArray(res.data)) return res.data as OmniDevice[];
      if (res.data && typeof res.data === 'object') {
        const obj = res.data as Record<string, unknown>;
        const list = obj.devices || obj.response || obj.data || obj.items;
        if (Array.isArray(list)) return list as OmniDevice[];
      }
      return [];
    } catch {
      return [];
    }
  }

  public static async getOmniNotifications(): Promise<OmniNotification[]> {
    try {
      const res = await this.request<BaseResponse<unknown>>(`${this.omniBase}/monitoring/notifications`);
      if (Array.isArray(res.data)) return res.data as OmniNotification[];
      if (res.data && typeof res.data === 'object') {
        const obj = res.data as Record<string, unknown>;
        const list = obj.notifications || obj.response || obj.data || obj.items;
        if (Array.isArray(list)) return list as OmniNotification[];
      }
      return [];
    } catch {
      return [];
    }
  }

  // --- Liveness Probes ---

  public static async checkHealth(
    fortiUrl: string = this.fortiBase,
    omniUrl: string = this.omniBase,
  ): Promise<{ forti: boolean; omni: boolean }> {
    const validFortiUrl = this.validateBaseUrl(fortiUrl, 'Fortinet');
    const validOmniUrl = this.validateBaseUrl(omniUrl, 'OmniVista');
    const fortiHealthUrl = validFortiUrl.replace(/\/api\/v1\/?$/, '') + '/health';
    const omniHealthUrl = validOmniUrl.replace(/\/api\/v1\/?$/, '') + '/health';

    const [fortiResult, omniResult] = await Promise.allSettled([
      fetch(fortiHealthUrl, { method: 'GET' }).then(r => r.ok),
      fetch(omniHealthUrl, { method: 'GET' }).then(r => r.ok),
    ]);

    return {
      forti: fortiResult.status === 'fulfilled' && fortiResult.value,
      omni: omniResult.status === 'fulfilled' && omniResult.value,
    };
  }
}
