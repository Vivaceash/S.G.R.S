export interface BaseResponse<T> {
  success: boolean;
  message?: string;
  data: T;
  request_id?: string;
  timestamp?: string;
}

export interface FortiDevice {
  mac: string;
  ip?: string | null;
  hostname?: string | null;
  hardware_vendor?: string | null;
  hardware_family?: string | null;
  os_name?: string | null;
  os_version?: string | null;
  interface?: string | null;
  is_online: boolean;
  last_seen?: number | string | null;
  device_type?: string | null;
  raw_attributes?: Record<string, unknown>;
}

export interface FortiDeviceListSummary {
  total_inventory?: number;
  online_devices: number;
  offline_devices?: number;
  returned_count?: number;
  total_devices: number;
  devices: FortiDevice[];
}

export interface FortiSystemResourceUsage {
  cpu_percent?: number | null;
  memory_percent?: number | null;
  session_count?: number | null;
  session_rate_per_sec?: number | null;
  disk_usage_percent?: number | null;
}

export interface FortiSystemStatus {
  hostname: string;
  serial: string;
  version: string;
  uptime_seconds: number;
  ha_mode?: string | null;
}

export interface FortiTrafficDestination {
  destination_ip: string;
  service_or_port: string;
  session_count: number;
}

export interface FortiDhcpLease {
  ip: string;
  mac: string;
  hostname?: string | null;
  interface: string;
  expire_time?: number | null;
}

export interface DhcpPoolScope {
  id: number;
  interface: string;
  default_gateway?: string;
  netmask?: string;
  ip_ranges: string[];
  capacity: number;
  active_leases: number;
  available_ips: number;
  utilization_percent: number;
  status: 'normal' | 'warning' | 'critical';
  lease_time_seconds?: number;
}

export interface DhcpPoolSummary {
  total_pools: number;
  total_capacity: number;
  total_active_leases: number;
  total_available_ips: number;
  global_saturation_percent: number;
  critical_pools_count: number;
  warning_pools_count: number;
  pools: DhcpPoolScope[];
}

export interface OmniInfrastructureStats {
  access_points_count: number;
  switches_count: number;
  other_devices_count: number;
  total_network_devices: number;
  employee_accounts_count: number;
  company_properties_count: number;
}

export interface OmniDevice {
  ip: string;
  mac?: string | null;
  device_name?: string | null;
  name?: string | null;
  model?: string | null;
  chassis_type?: string | null;
  status?: string | null;
  type?: string | null;
  location?: string | null;
}

export interface OmniNotification {
  id?: string | number;
  severity?: string;
  message?: string;
  source?: string;
  timestamp?: string;
}

export interface UnifiedDevice {
  id: string;
  name: string;
  ip: string;
  mac: string;
  type: string;
  vendor: string;
  location: string;
  status: 'online' | 'offline';
  source: 'fortigate' | 'omnivista';
  lastSeen: string;
}

export interface ActivityEvent {
  id: string;
  title: string;
  description: string;
  time: string;
  type: 'up' | 'down' | 'warn' | 'info';
  author: string;
}

export interface SubnetCapacity {
  name: string;
  used: number;
  total: number;
  colorClass: string;
}
