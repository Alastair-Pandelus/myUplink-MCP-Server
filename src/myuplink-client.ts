import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://api.myuplink.com";
const TOKEN_URL = "https://api.myuplink.com/oauth/token";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface System {
  systemId: string;
  name: string;
  securityLevel: string;
  hasAlarm: boolean;
  country: string;
  devices: Device[];
}

export interface Device {
  id: string;
  connectionState: string;
  currentFwVersion: string;
  product: {
    serialNumber: string;
    name: string;
  };
}

export interface DataPoint {
  category: string;
  parameterId: string;
  parameterName: string;
  parameterUnit: string;
  writable: boolean;
  timestamp: string;
  value: number | null;
  strVal: string;
  smartHomeCategories: string[];
  minValue: number | null;
  maxValue: number | null;
  stepValue: number;
  enumValues: { value: string; text: string; icon: string }[];
}

export interface SetParameterPayload {
  [parameterId: string]: string | number;
}

export class MyUplinkClient {
  private http: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string = "http://localhost:3000/callback"
  ) {
    this.http = axios.create({ baseURL: BASE_URL });
  }

  // ─── OAuth helpers ──────────────────────────────────────────────────────────

  /** Returns the URL the user should visit to authorise the app. */
  getAuthorizationUrl(scope = "READSYSTEM WRITESYSTEM offline_access"): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope,
    });
    return `${BASE_URL}/oauth/authorize?${params}`;
  }

  /** Exchange an authorisation code for tokens (Authorization Code flow). */
  async exchangeCode(code: string): Promise<TokenResponse> {
    const resp = await axios.post<TokenResponse>(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    this._storeTokens(resp.data);
    return resp.data;
  }

  /** Obtain tokens via Client Credentials (no user interaction needed). */
  async authenticateClientCredentials(
    scope = "READSYSTEM"
  ): Promise<TokenResponse> {
    const resp = await axios.post<TokenResponse>(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    this._storeTokens(resp.data);
    return resp.data;
  }

  /** Restore previously-saved tokens (e.g. from .env / file). */
  setTokens(accessToken: string, refreshToken?: string, expiresAt?: Date) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken ?? null;
    this.tokenExpiry = expiresAt ?? null;
  }

  private _storeTokens(t: TokenResponse) {
    this.accessToken = t.access_token;
    this.refreshToken = t.refresh_token ?? null;
    this.tokenExpiry = new Date(Date.now() + (t.expires_in - 60) * 1000);
  }

  private async _refreshIfNeeded() {
    if (
      this.accessToken &&
      this.tokenExpiry &&
      new Date() < this.tokenExpiry
    ) {
      return; // still valid
    }
    if (this.refreshToken) {
      const resp = await axios.post<TokenResponse>(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      this._storeTokens(resp.data);
    } else {
      // Fall back to client_credentials
      await this.authenticateClientCredentials();
    }
  }

  private async authHeaders() {
    await this._refreshIfNeeded();
    if (!this.accessToken) throw new Error("Not authenticated – call authenticate() first.");
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  // ─── API methods ─────────────────────────────────────────────────────────────

  async getSystems(): Promise<System[]> {
    const resp = await this.http.get<{ page: number; itemsPerPage: number; numItems: number; systems: System[] }>(
      "/v2/systems/me",
      { headers: await this.authHeaders() }
    );
    return resp.data.systems;
  }

  async getSystem(systemId: string): Promise<System> {
    const resp = await this.http.get<System>(`/v2/systems/${systemId}`, {
      headers: await this.authHeaders(),
    });
    return resp.data;
  }

  async getDevicePoints(
    deviceId: string,
    parameterIds?: string[]
  ): Promise<DataPoint[]> {
    const params: Record<string, string> = {};
    if (parameterIds?.length) params["parameterId"] = parameterIds.join(",");
    const resp = await this.http.get<DataPoint[]>(
      `/v2/devices/${deviceId}/points`,
      { headers: await this.authHeaders(), params }
    );
    return resp.data;
  }

  async setDevicePoints(
    deviceId: string,
    settings: SetParameterPayload
  ): Promise<void> {
    await this.http.patch(`/v2/devices/${deviceId}/points`, settings, {
      headers: await this.authHeaders(),
    });
  }

  async getDevice(deviceId: string): Promise<Device> {
    const resp = await this.http.get<Device>(`/v2/devices/${deviceId}`, {
      headers: await this.authHeaders(),
    });
    return resp.data;
  }

  async getSmartHomeCategories(deviceId: string): Promise<unknown> {
    const resp = await this.http.get(
      `/v2/devices/${deviceId}/smart-home-categories`,
      { headers: await this.authHeaders() }
    );
    return resp.data;
  }

  async getSmartHomeZones(deviceId: string): Promise<unknown> {
    const resp = await this.http.get(
      `/v2/devices/${deviceId}/smart-home-zones`,
      { headers: await this.authHeaders() }
    );
    return resp.data;
  }

  async getAlarms(systemId: string): Promise<unknown> {
    const resp = await this.http.get(`/v2/systems/${systemId}/notifications`, {
      headers: await this.authHeaders(),
    });
    return resp.data;
  }
}
