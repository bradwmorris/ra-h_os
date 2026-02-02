// API Key Storage Service
// Handles storage and retrieval of OpenAI API key

export interface ApiKeyStatus {
  openai: 'connected' | 'failed' | 'testing' | 'not-set';
}

const STORAGE_KEY = 'ra-h-api-keys';
const FIRST_RUN_KEY = 'ra-h-first-run-complete';

export class ApiKeyService {
  private static instance: ApiKeyService;
  private openaiKey: string | undefined;
  private status: ApiKeyStatus = {
    openai: 'not-set',
  };

  static getInstance(): ApiKeyService {
    if (!ApiKeyService.instance) {
      ApiKeyService.instance = new ApiKeyService();
    }
    return ApiKeyService.instance;
  }

  constructor() {
    this.loadKeys();
  }

  // Load keys from localStorage
  private loadKeys(): void {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          this.openaiKey = parsed.openai;
        }
      }
    } catch (error) {
      console.warn('Failed to load API keys from storage:', error);
      this.openaiKey = undefined;
    }
  }

  // Save keys to localStorage
  private saveKeys(): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ openai: this.openaiKey }));
      }
    } catch (error) {
      console.error('Failed to save API keys to storage:', error);
    }
  }

  // Get OpenAI API key (user key or fallback to env)
  getOpenAiKey(): string | undefined {
    // Priority: User key > Environment key
    return this.openaiKey || process.env.OPENAI_API_KEY;
  }

  // Set OpenAI API key
  setOpenAiKey(key: string): void {
    if (this.validateOpenAiKey(key)) {
      this.openaiKey = key;
      this.saveKeys();
    } else {
      throw new Error('Invalid OpenAI API key format');
    }
  }

  // Clear OpenAI key
  clearOpenAiKey(): void {
    this.openaiKey = undefined;
    this.saveKeys();
    this.status.openai = 'not-set';
  }

  // Get masked key for display (show only last 4 characters)
  getMaskedOpenAiKey(): string {
    if (!this.openaiKey) return '';
    return '••••••••••••••••••••' + this.openaiKey.slice(-4);
  }

  // Check if user has provided a key
  hasOpenAiKey(): boolean {
    return !!this.openaiKey;
  }

  // Validate OpenAI key format
  private validateOpenAiKey(key: string): boolean {
    return (
      typeof key === 'string' &&
      key.length > 20 &&
      (key.startsWith('sk-') || key.startsWith('sk-proj-'))
    );
  }

  // Test connection to OpenAI
  async testOpenAiConnection(key?: string): Promise<boolean> {
    const testKey = key || this.getOpenAiKey();
    if (!testKey) return false;

    this.status.openai = 'testing';

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${testKey}`,
          'Content-Type': 'application/json',
        },
      });

      const isConnected = response.ok;
      this.status.openai = isConnected ? 'connected' : 'failed';
      return isConnected;
    } catch (error) {
      console.error('OpenAI connection test failed:', error);
      this.status.openai = 'failed';
      return false;
    }
  }

  // Get connection status
  getStatus(): ApiKeyStatus {
    return { ...this.status };
  }

  // Update status
  updateStatus(status: ApiKeyStatus['openai']): void {
    this.status.openai = status;
  }

  // First-run tracking
  isFirstRun(): boolean {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem(FIRST_RUN_KEY);
  }

  markFirstRunComplete(): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FIRST_RUN_KEY, 'true');
    }
  }
}

// Export singleton instance
export const apiKeyService = ApiKeyService.getInstance();
