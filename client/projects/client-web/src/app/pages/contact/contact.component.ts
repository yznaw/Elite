import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

interface InfoBlock {
  icon: string;
  titleKey: string;
  lineKeys: string[];
}

@Component({
  selector: 'cw-contact',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss',
})
export class ContactComponent {
  private readonly i18n = inject(I18nService);

  readonly t = (key: string): string => this.i18n.t(key);

  readonly subjects = [
    'contact.subject.bespoke',
    'contact.subject.product',
    'contact.subject.sizing',
    'contact.subject.order',
    'contact.subject.press',
  ];

  readonly form = signal<ContactForm>({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  });
  readonly submitted = signal(false);

  readonly infoBlocks: InfoBlock[] = [
    {
      icon: '◆',
      titleKey: 'contact.info.atelier.title',
      lineKeys: ['contact.info.atelier.l1', 'contact.info.atelier.l2', 'contact.info.atelier.l3'],
    },
    {
      icon: '◇',
      titleKey: 'contact.info.appointments.title',
      lineKeys: [
        'contact.info.appointments.l1',
        'contact.info.appointments.l2',
        'contact.info.appointments.l3',
      ],
    },
    {
      icon: '◈',
      titleKey: 'contact.info.client.title',
      lineKeys: ['contact.info.client.l1', 'contact.info.client.l2', 'contact.info.client.l3'],
    },
  ];

  set<K extends keyof ContactForm>(key: K, value: ContactForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  onSubmit(): void {
    this.submitted.set(true);
  }
}
