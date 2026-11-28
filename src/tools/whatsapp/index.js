'use strict';

const config = require('../../config');
const { isSenderAuthorized } = require('../../utils/security');
const logger = require('../../utils/logger').child('WhatsAppTools');
const child_process = require('child_process');

/**
 * WhatsApp Control Plane Tools (PRD Section 18, 19, 40)
 */
const WhatsAppTools = {
  /**
   * Check if sender is authorized (Fail-closed rule FR-009)
   */
  checkAuthorization(senderId) {
    return isSenderAuthorized(senderId);
  },

  /**
   * Deliver message to target WhatsApp number via OpenClaw
   */
  async sendMessage(text, { targetNumber = null, mediaFiles = [] } = {}) {
    const destination = targetNumber || config.whatsapp.targetPhoneNumber;
    if (!destination) {
      logger.warn('No target WhatsApp phone number configured. Outputting to console.');
      console.log('\n--- [WHATSAPP MESSAGE STAGED] ---\n' + text + '\n---------------------------------\n');
      return { delivered: false, simulated: true };
    }

    logger.info(`Sending WhatsApp message to ${destination}...`);
    try {
      const openclawBin = config.whatsapp.openclawBin;
      const args = ['message', 'send', '--channel', 'whatsapp', '--target', destination, '--message', text];
      for (const m of mediaFiles) {
        args.push('--media', m);
      }

      const child = child_process.spawn(openclawBin, args, {
        stdio: 'ignore',
        detached: true,
      });
      child.unref();

      return { delivered: true, destination };
    } catch (err) {
      logger.warn(`Could not dispatch WhatsApp message via OpenClaw: ${err.message}`);
      return { delivered: false, error: err.message };
    }
  },

  /**
   * Format and send Human Approval Gate request (PRD FR-008)
   */
  async sendApprovalRequest({ campaignId, projectName, wordCount, seoScore, technicalScore, channels = [], liveUrl = '' }) {
    const channelList = channels.map((c) => `✓ ${c.toUpperCase()}`).join('\n');
    const msg = `🚀 *Marketing Campaign Ready for Approval*

*Project:* ${projectName}
*Campaign ID:* \`${campaignId}\`

*Article Quality:*
✓ ${wordCount} words
✓ SEO Quality Score: ${seoScore}/100
✓ Technical Accuracy: ${technicalScore}/100

*Planned Channels:*
${channelList}

*Target Live URL:*
${liveUrl}

━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply to proceed:
• *approve ${campaignId}*
• *reject ${campaignId}*
• *preview ${campaignId}*
• *cancel ${campaignId}*`;

    return this.sendMessage(msg);
  },

  /**
   * Format and send Campaign Status update
   */
  async sendStatusUpdate({ campaignId, projectName, status, currentStep, channelsPublished = [] }) {
    const msg = `📊 *Campaign Status Update*

*Project:* ${projectName}
*Campaign ID:* \`${campaignId}\`
*Status:* *${status}*
*Step:* ${currentStep || 'In progress'}
*Publications:* ${channelsPublished.length > 0 ? channelsPublished.join(', ') : 'None yet'}

Send \`campaign status ${campaignId}\` for detailed metrics.`;

    return this.sendMessage(msg);
  },
};

module.exports = WhatsAppTools;
