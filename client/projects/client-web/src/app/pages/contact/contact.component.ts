import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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
  private readonly http        = inject(HttpClient);
  private readonly apiBase     = this.resolveApiBase();

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
  readonly submitting = signal(false);
  readonly error = signal('');

  ngOnInit(): void {
    void this.homeContent.refresh(true);
  }

  set<K extends keyof ContactForm>(key: K, value: ContactForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;

    const form = this.form();
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      subject: form.subject ? this.t(form.subject) : '',
      message: form.message.trim(),
      locale: this.locale.locale(),
    };

    if (!payload.name || !payload.email || !payload.message) {
      this.error.set(this.t('contact.error.required'));
      return;
    }

    this.submitting.set(true);
    this.error.set('');

    try {
      await firstValueFrom(this.http.post(`${this.apiBase}/contact`, payload));
      this.submitted.set(true);
      this.form.set({ name: '', email: '', phone: '', subject: '', message: '' });
    } catch {
      this.error.set(this.t('contact.error.submit'));
    } finally {
      this.submitting.set(false);
    }
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]'
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
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
