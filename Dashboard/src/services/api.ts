import type {
  BaseResponse,
  FortiDeviceListSummary,
  FortiSystemResourceUsage,
  FortiSystemStatus,
  FortiTrafficDestination,
  FortiDhcpLease,
  OmniInfrastructureStats,
  OmniDevice,
  OmniNotification,
} from '../types';

export class ApiService {
  private static fortiBase = localStorage.getItem('sgrs_forti_url') || 'http://localhost:8001/api/v1';
  private static omniBase = localStorage.getItem('sgrs_omni_url') || 'http://localhost:8000/api/v1';
  private static apiKey = localStorage.getItem('sgrs_api_key') || 'admin';

  public static getFortiUrl(): string {
    return this.fortiBase;
  }

  public static getOmniUrl(): string {
    return this.omniBase;
  }

  public static getApiKey(): string {
    return this.apiKey;
  }

  public static updateConfig(fortiUrl: string, omniUrl: string, key: string) {
    this.fortiBase = fortiUrl.replace(/\/$/, '');
    this.omniBase = omniUrl.replace(/\/$/, '');
    this.apiKey = key.trim();
    localStorage.setItem('sgrs_forti_url', this.fortiBase);
    localStorage.setItem('sgrs_omni_url', this.omniBase);
    localStorage.setItem('sgrs_api_key', this.apiKey);
  }

  private static async request<T>(url: string, timeoutMs: number = 18000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
          'Accept': 'application/json',
        },
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

  public static async getFortiDevices(): Promise<FortiDeviceListSummary> {
    const res = await this.request<BaseResponse<FortiDeviceListSummary>>(`${this.fortiBase}/devices`);
    return {
      total_devices: res.data?.total_devices ?? 0,
      online_devices: res.data?.online_devices ?? 0,
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

  public static async checkHealth(): Promise<{ forti: boolean; omni: boolean }> {
    const fortiHealthUrl = this.fortiBase.replace('/api/v1', '') + '/health';
    const omniHealthUrl = this.omniBase.replace('/api/v1', '') + '/health';

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
