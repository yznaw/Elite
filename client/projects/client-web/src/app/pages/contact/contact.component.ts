import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

interface InfoBlock {
  icon: string;
  title: string;
  lines: string[];
}

@Component({
  selector: 'cw-contact',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss',
})
export class ContactComponent {
  readonly subjects = [
    'Bespoke Commission',
    'Product Inquiry',
    'Sizing Assistance',
    'Order Support',
    'Press & Partnerships',
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
      title: 'Doha Atelier',
      lines: ['Al-Dirah Quarter, Doha', 'Kingdom of Qatar', 'Open Sun–Thu, 9am–6pm'],
    },
    {
      icon: '◇',
      title: 'Private Appointments',
      lines: [
        'Bespoke consultations by appointment',
        'In-atelier or at your residence',
        'Available 7 days a week',
      ],
    },
    {
      icon: '◈',
      title: 'Client Services',
      lines: ['+966 11 XXX XXXX', 'advisors@elitecollection.sa', 'Response within 2 hours'],
    },
  ];

  set<K extends keyof ContactForm>(key: K, value: ContactForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  onSubmit(): void {
    this.submitted.set(true);
  }
}
