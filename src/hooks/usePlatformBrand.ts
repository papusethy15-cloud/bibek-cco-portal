/**
 * usePlatformBrand — fetches platform branding from the public settings endpoint
 * (no auth required). Falls back to static defaults if the DB has no values set.
 * Automatically updates the document title and favicon on load.
 */
import { useState, useEffect } from 'react';
import axios from 'axios';

export interface PlatformBrand {
  app_name:      string;
  tagline:       string;
  logo_url:      string;
  favicon_url:   string;
  primary_color: string;
}

const DEFAULTS: PlatformBrand = {
  app_name:      'CCO Portal',
  tagline:       'Palei Solutions — Customer Care Operations',
  logo_url:      '',
  favicon_url:   '',
  primary_color: '#1B4FD8',
};

const BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000/api/v1';

// Module-level cache so multiple components share one fetch
let _cached: PlatformBrand | null = null;
let _promise: Promise<PlatformBrand> | null = null;

function fetchBrand(): Promise<PlatformBrand> {
  if (_cached) return Promise.resolve(_cached);
  if (_promise) return _promise;

  _promise = axios
    .get(`${BASE_URL}/settings/platform/public`, { timeout: 5000 })
    .then(res => {
      const d = res.data?.data || {};
      const brand: PlatformBrand = {
        app_name:      d.app_name      || DEFAULTS.app_name,
        tagline:       d.tagline       || DEFAULTS.tagline,
        logo_url:      d.logo_url      || '',
        favicon_url:   d.favicon_url   || '',
        primary_color: d.primary_color || DEFAULTS.primary_color,
      };
      _cached = brand;
      return brand;
    })
    .catch(() => {
      _cached = DEFAULTS;
      return DEFAULTS;
    });

  return _promise;
}

export function usePlatformBrand(): PlatformBrand {
  const [brand, setBrand] = useState<PlatformBrand>(_cached || DEFAULTS);

  useEffect(() => {
    fetchBrand().then(b => {
      setBrand(b);
      // Update browser tab title
      document.title = b.app_name + ' — CCO Portal';
      // Update favicon if set
      if (b.favicon_url) {
        let link = document.getElementById('app-favicon') as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement('link');
          link.id  = 'app-favicon';
          link.rel = 'shortcut icon';
          link.type = 'image/x-icon';
          document.head.appendChild(link);
        }
        link.href = b.favicon_url;
      }
    });
  }, []);

  return brand;
}
