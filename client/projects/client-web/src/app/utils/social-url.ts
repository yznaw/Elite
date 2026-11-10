import { SocialLink } from '../models/home-content.model';

/**
 * Public profile URL for a social handle as entered in the admin.
 *
 * One definition for the footer, the contact page and the home page's
 * Organization `sameAs`, which all have to agree: `sameAs` is how search
 * engines and AI answers connect this site to the brand's other profiles, so
 * a link that differs from the one on the page weakens that connection.
 *
 * Returns '#' for an unknown platform.
 */
export function socialUrl(link: SocialLink): string {
  const handle = link.handle.trim();
  const digits = handle.replace(/\D/g, '');
  switch (link.platform) {
    case 'whatsapp':  return `https://wa.me/${digits}`;
    case 'instagram': return `https://instagram.com/${handle}`;
    case 'twitter':   return `https://x.com/${handle}`;
    case 'facebook':  return `https://facebook.com/${handle}`;
    case 'tiktok':    return `https://tiktok.com/@${handle}`;
    case 'snapchat':  return `https://snapchat.com/add/${handle}`;
    case 'youtube':   return `https://youtube.com/@${handle}`;
    case 'linkedin':  return `https://linkedin.com/in/${handle}`;
    default:          return '#';
  }
}
