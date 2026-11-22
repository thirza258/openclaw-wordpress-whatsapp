'use strict';

const bluesky = require('./bluesky');
const { XProvider, ThreadsProvider, FacebookProvider, InstagramProvider, TikTokProvider } = require('./generic');

const providers = {
  bluesky,
  x: XProvider,
  threads: ThreadsProvider,
  facebook: FacebookProvider,
  instagram: InstagramProvider,
  tiktok: TikTokProvider,
};

function getSocialProvider(channel) {
  const normalized = (channel || '').toLowerCase().trim();
  const provider = providers[normalized];
  if (!provider) {
    throw new Error(`Unsupported social channel provider: ${channel}`);
  }
  return provider;
}

module.exports = {
  getSocialProvider,
  providers,
};
