import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Chapter {
  year: string;
  title: string;
  body: string;
  image: string;
  align: 'left' | 'right';
}

interface Master {
  role: string;
  experience: string;
}

@Component({
  selector: 'cw-story',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story.component.html',
  styleUrl: './story.component.scss',
})
export class StoryComponent {
  readonly heroImage =
    'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=1400&q=85&auto=format&fit=crop';

  readonly chapters: Chapter[] = [
    {
      year: '1962',
      title: 'A Workshop in Al-Dirah',
      body:
        "In the ancient souks of Doha's Al-Dirah quarter, master cobbler Khalid Al-Rashidi opened a workshop with nothing but a single last, a curved needle, and an uncompromising vision. Every pair he produced bore the weight of his name — each stitch a contract between craftsman and wearer.",
      image: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=900&q=85&auto=format&fit=crop',
      align: 'left',
    },
    {
      year: '1978',
      title: 'The Camel Leather Discovery',
      body:
        "A chance encounter with Bedouin leather traders from the Najd plateau introduced Khalid to full-grain camel hide — a material of extraordinary durability, warmth, and a grain unlike anything sourced from European tanneries. The leather breathes in desert heat and softens with wear into a second skin. It became the house's defining material overnight.",
      image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=900&q=85&auto=format&fit=crop',
      align: 'right',
    },
    {
      year: '1995',
      title: 'Royal Patronage',
      body:
        'By royal appointment, Elite began crafting bespoke footwear for members of the Saudi royal household and senior government ministers. Each commission took between 60 and 90 days — a testament to the refusal to compromise quality for speed. Word spread quietly, as it does among those who know.',
      image: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=900&q=85&auto=format&fit=crop',
      align: 'left',
    },
    {
      year: 'Today',
      title: 'Twelve Hands, One Pair',
      body:
        'Today, every pair passes through the hands of twelve specialists — from the leather cutter who has worked here for 30 years, to the finisher who hand-burnishes each edge with beeswax and carnauba. We limit production to 400 pairs per year. Not because we must, but because excellence demands it. Each pair ships with a numbered certificate signed by its maker.',
      image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=900&q=85&auto=format&fit=crop',
      align: 'right',
    },
  ];

  readonly masters: Master[] = [
    { role: 'Leather Selector', experience: '30 yrs' },
    { role: 'Pattern Cutter', experience: '22 yrs' },
    { role: 'Last Maker', experience: '18 yrs' },
    { role: 'Welt Stitcher', experience: '25 yrs' },
    { role: 'Heel Builder', experience: '15 yrs' },
    { role: 'Edge Finisher', experience: '28 yrs' },
  ];

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }
}
