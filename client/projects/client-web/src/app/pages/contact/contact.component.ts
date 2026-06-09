import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { HomeContentService } from '../../services/home-content.service';
import { SocialLink } from '../../models/home-content.model';

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

@Component({
  selector: 'cw-contact',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss',
})
export class ContactComponent implements OnInit {
  private readonly i18n        = inject(I18nService);
  readonly locale              = inject(LocaleService);
  private readonly homeContent = inject(HomeContentService);

  readonly t = (key: string): string => this.i18n.t(key);
  readonly contactContent = computed(() => this.homeContent.contentData().contact);
  readonly activeSocialLinks = computed(() =>
    this.contactContent().socialLinks?.filter((s) => s.enabled) ?? []
  );

  readonly subjects = [
    'contact.subject.bespoke',
    'contact.subject.product',
    'contact.subject.sizing',
    'contact.subject.order',
    'contact.subject.press',
  ];

  readonly form      = signal<ContactForm>({ name: '', email: '', phone: '', subject: '', message: '' });
  readonly submitted = signal(false);

  ngOnInit(): void {
    void this.homeContent.refresh(true);
  }

  set<K extends keyof ContactForm>(key: K, value: ContactForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  onSubmit(): void {
    this.submitted.set(true);
  }

  private sanitizePhone(phone: string): string {
    return phone.trim().replace(/\D/g, '');
  }

  socialUrl(link: SocialLink): string {
    const h = link.handle.trim();
    const sanitized = this.sanitizePhone(h);
    switch (link.platform) {
      case 'whatsapp':  return `https://wa.me/${sanitized}`;
      case 'instagram': return `https://instagram.com/${h}`;
      case 'twitter':   return `https://x.com/${h}`;
      case 'facebook':  return `https://facebook.com/${h}`;
      case 'tiktok':    return `https://tiktok.com/@${h}`;
      case 'snapchat':  return `https://snapchat.com/add/${h}`;
      case 'youtube':   return `https://youtube.com/@${h}`;
      case 'linkedin':  return `https://linkedin.com/in/${h}`;
      default:          return '#';
    }
  }

  whatsappUrl(): string {
    const num = this.contactContent().whatsapp || '';
    return `https://wa.me/${this.sanitizePhone(num)}`;
  }

  socialLabel(platform: string): string {
    const labels: Record<string, string> = {
      whatsapp: 'WhatsApp', instagram: 'Instagram', twitter: 'X (Twitter)',
      facebook: 'Facebook', tiktok: 'TikTok', snapchat: 'Snapchat',
      youtube: 'YouTube', linkedin: 'LinkedIn',
    };
    return labels[platform] ?? platform;
  }
}
