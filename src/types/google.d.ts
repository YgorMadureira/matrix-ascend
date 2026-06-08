// Type declarations for Google Identity Services (GIS)
interface GoogleTokenClient {
  requestAccessToken: () => void;
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: {
      access_token?: string;
      error?: string;
      expires_in?: number;
    }) => void;
  }) => GoogleTokenClient;
}

interface GoogleAccounts {
  oauth2: GoogleOAuth2;
}

interface Google {
  accounts: GoogleAccounts;
}

declare global {
  interface Window {
    google?: Google;
  }
}

export {};
