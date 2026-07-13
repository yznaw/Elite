import {
  Component, OnInit, OnDestroy, inject, signal, computed, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

type KioskStep = 'welcome' | 'product' | 'rating' | 'message' | 'contact' | 'thanks';
type KioskLang = 'en' | 'ar';

interface Particle { html: SafeHtml; style: string; }

const PARTICLE_ICONS = [
  // Sandal — sole + three straps
  `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="24" viewBox="0 0 42 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17C11 12 31 12 38 17"/><path d="M12 12L15 5M21 12V5M30 12L27 5"/><path d="M4 17Q21 22 38 17"/></svg>`,
  // Scissors — blades + rings
  `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="6" cy="7" r="4.5"/><circle cx="6" cy="23" r="4.5"/><path d="M11 9.5L28 20M11 20.5L28 10"/></svg>`,
  // Needle with thread
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="42" viewBox="0 0 10 42" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><ellipse cx="5" cy="5" rx="3" ry="4.5"/><line x1="3" y1="5" x2="7" y2="5"/><line x1="5" y1="9.5" x2="5" y2="38"/><path d="M5 38Q3 40 2 42"/></svg>`,
  // Leaf / hide silhouette
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="32" viewBox="0 0 22 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M11 30C11 30 1 21 1 12 1 5 6 1 11 1 16 1 21 5 21 12 21 21 11 30 11 30Z"/><line x1="11" y1="30" x2="11" y2="9"/><path d="M11 22L6 15M11 16L16 9"/></svg>`,
  // Diamond ◇
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 1L21 11L11 21L1 11Z"/></svg>`,
  // Thread spool
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><ellipse cx="12" cy="5" rx="10" ry="4"/><ellipse cx="12" cy="23" rx="10" ry="4"/><line x1="2" y1="5" x2="2" y2="23"/><line x1="22" y1="5" x2="22" y2="23"/><ellipse cx="12" cy="14" rx="6" ry="2.5"/></svg>`,
  // Stitch line
  `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="14" viewBox="0 0 36 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="4 4"><line x1="2" y1="7" x2="34" y2="7"/><path d="M6 2L6 12M12 2L12 12M18 2L18 12M24 2L24 12M30 2L30 12" stroke-dasharray="none" stroke-width="1"/></svg>`,
];

interface KioskProduct { id: string; name: string; image: string; }
interface ApiEnvelope<T> { success: boolean; data: T; }

// ── All UI strings in both languages ─────────────────────────────────────────
const STRINGS: Record<KioskLang, Record<string, string>> = {
  en: {
    logoSub:         'Arabic Leather Artisans',
    welcomeTitle:    'Every Step Matters.',
    welcomeSub:      'Your discerning eye refines our legacy. Kindly share your impressions.',
    welcomeBtn:      'Share Your Thoughts',
    privacy:         'This requires mere moments. Your privacy remains absolute.',

    selectEyebrow:   'Step 1',
    selectTitle:     'Which creation accompanied you today?',
    selectSkip:      'Reflect on the Boutique Experience',
    selectContinue:  'Choose a Masterpiece',

    ratingEyebrow:   'Your impression',
    ratingTitle:     'How would you rate\nyour experience?',
    ratingPoor:      'Unfulfilling',
    ratingExcellent: 'A Masterpiece',
    ratingVal1:      'Unfulfilling',
    ratingVal2:      'Ordinary',
    ratingVal3:      'Admirable',
    ratingVal4:      'Exemplary',
    ratingVal5:      'A Masterpiece',
    ratingHint:      'Tap to share your impression',

    messageTitle:    'The Art of Detail.',
    messageSub:      'What resonated with you? (The touch of the leather, the precision of the stitch, the warmth of our service).',
    messagePlaceholder: 'Share your impressions here...',
    messageSkip:     'Proceed Without Sharing',
    messageContinue: 'Continue',

    contactTitle:    'For Your Utmost Satisfaction.',
    contactSub:      'We ask for these details solely to refine our craft and ensure your happiness. Your information is held in strict confidence and will never be used for commercial or marketing purposes.',
    contactName:     'Name',
    contactPhone:    'Mobile',
    contactEmail:    'Email',
    contactNote:     'Your information is held in strict confidence',
    contactSkip:     'I prefer to remain anonymous.',
    contactSubmit:   'Submit',
    contactSending:  'Sending…',

    thanksTitle:     'With Deepest Gratitude.',
    thanksSub:       'Your words are entrusted to our artisans, shaping the future of our craft.',
    thanksRestart:   'New Response',
    thanksCountdown: 'The screen will refresh momentarily',
    thanksSeconds:   '…',

    noProducts:      'No collections available right now',
    noProductsSub:   'You may still leave us your thoughts below',

    langToggle:      'عربي',
  },
  ar: {
    logoSub:         'حِرَفيّو الجِلد العربي',
    welcomeTitle:    'كل خطوة تهمنا.',
    welcomeSub:      'ذوقكم الرفيع يرتقي بصنعتنا. تفضلوا بمشاركتنا انطباعكم.',
    welcomeBtn:      'شاركونا رأيكم',
    privacy:         'لن يستغرق الأمر سوى لحظات. خصوصيتكم تامة ومضمونة.',

    selectEyebrow:   'الخطوة الأولى',
    selectTitle:     'أي إبداعاتنا رافقتكم اليوم؟',
    selectSkip:      'تقييم تجربة البوتيك العامة',
    selectContinue:  'اختيار القطعة',

    ratingEyebrow:   'انطباعكم',
    ratingTitle:     'كيف تقيّمون\nتجربتكم معنا؟',
    ratingPoor:      'دون التطلعات',
    ratingExcellent: 'تحفة فنية',
    ratingVal1:      'دون التطلعات',
    ratingVal2:      'اعتيادية',
    ratingVal3:      'متقنة',
    ratingVal4:      'استثنائية',
    ratingVal5:      'تحفة فنية',
    ratingHint:      'اختر للتعبير عن انطباعك',

    messageTitle:    'لغة التفاصيل.',
    messageSub:      'ما الذي لفت انتباهكم؟ (ملمس الجلد، دقة الحياكة، أو رقي الخدمة).',
    messagePlaceholder: 'شاركونا انطباعكم هنا...',
    messageSkip:     'المتابعة دون كتابة',
    messageContinue: 'متابعة',

    contactTitle:    'لضمان رضاكم التام.',
    contactSub:      'نطلب هذه البيانات حصرياً للارتقاء بحرفيتنا وضمان سعادتكم. معلوماتكم تبقى في غاية السرية، ولن تُستخدم مطلقاً لأي أغراض تجارية أو تسويقية.',
    contactName:     'الاسم',
    contactPhone:    'رقم الجوال',
    contactEmail:    'البريد الإلكتروني',
    contactNote:     'معلوماتكم محفوظة بالسرية التامة',
    contactSkip:     'أفضل البقاء كمجهول.',
    contactSubmit:   'إرسال',
    contactSending:  'جارٍ الإرسال…',

    thanksTitle:     'بخالص الامتنان.',
    thanksSub:       'كلماتكم تصل إلى حرفيينا شخصياً، وتلهمنا لتقديم الأفضل.',
    thanksRestart:   'رأي جديد',
    thanksCountdown: 'سيتم تحديث الشاشة لحظات',
    thanksSeconds:   '…',

    noProducts:      'لا توجد مجموعات متاحة حالياً',
    noProductsSub:   'يمكنكم إبداء رأيكم العام أدناه',

    langToggle:      'English',
  },
};

@Component({
  selector: 'app-kiosk',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="k-shell" [attr.dir]="lang() === 'ar' ? 'rtl' : 'ltr'"
         (click)="resetActivity()" (touchstart)="resetActivity()">

      <!-- ── Screen 1: Welcome ─────────────────────────────────── -->
      @if (step() === 'welcome') {
        <div class="kiosk k-welcome">
          <div class="k-welcome-bg"></div>
          <button class="k-lang-pill k-lang-welcome" type="button" (click)="$event.stopPropagation(); toggleLang()">
            {{ s('langToggle') }}
          </button>
          <img src="/assets/brand/elite-logo-cream.png" alt="Elite Collection" class="k-logo-img"/>
          <div class="k-logo-sub">{{ s('logoSub') }}</div>
          <div class="k-diamond-line"><span class="k-diamond">◇</span></div>
          <div class="k-welcome-title" [innerHTML]="s('welcomeTitle').replace('\\n','<br>')"></div>
          <div class="k-welcome-sub" [innerHTML]="s('welcomeSub').replace('\\n','<br>')"></div>
          <button class="k-start-btn" (click)="startFlow()">{{ s('welcomeBtn') }}</button>
          <div class="k-privacy">◇ &nbsp; {{ s('privacy') }}</div>
        </div>
      }

      <!-- ── Screen 2: Product picker ──────────────────────────── -->
      @if (step() === 'product') {
        <div class="kiosk k-product">
          <div class="k-step-header">
            <img src="/assets/brand/elite-logo-cream.png" alt="Elite Collection" class="k-step-logo-img"/>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot" [class.on]="$index === 0"></div>
              }
            </div>
            <div class="k-step-header-right">
              <button class="k-lang-pill" type="button" (click)="$event.stopPropagation(); toggleLang()">
                {{ s('langToggle') }}
              </button>
              <button class="k-step-skip" type="button" (click)="skipProduct()">{{ s('selectSkip') }}</button>
            </div>
          </div>
          <div class="k-product-content">
            <div class="k-product-header">
              <div class="k-rate-eyebrow">{{ s('selectEyebrow') }}</div>
              <div class="k-rate-title">{{ s('selectTitle') }}</div>
            </div>
            @if (loadingProducts()) {
              <div class="k-loading-dots"><span></span><span></span><span></span></div>
            } @else if (products().length === 0) {
              <div class="k-empty-products">
                <div class="k-empty-icon">◈</div>
                <div class="k-empty-text">{{ s('noProducts') }}</div>
                <div class="k-empty-sub">{{ s('noProductsSub') }}</div>
              </div>
            } @else {
              <div class="k-product-grid">
                @for (p of products(); track p.id) {
                  <button class="k-product-card" type="button"
                          [class.on]="selectedProductId() === p.id"
                          (click)="selectAndAdvance(p.id)">
                    <div class="k-product-img-wrap">
                      @if (p.image) {
                        <img [src]="p.image" [alt]="p.name" class="k-product-img"/>
                      } @else {
                        <div class="k-product-placeholder">◈</div>
                      }
                      @if (selectedProductId() === p.id) {
                        <div class="k-product-check">✓</div>
                      }
                    </div>
                    <div class="k-product-name">{{ p.name }}</div>
                  </button>
                }
              </div>
            }
          </div>
        </div>
      }

      <!-- ── Screen 3: Rating ───────────────────────────────────── -->
      @if (step() === 'rating') {
        <div class="kiosk k-rating">
          <div class="k-step-header">
            <img src="/assets/brand/elite-logo-cream.png" alt="Elite Collection" class="k-step-logo-img"/>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot" [class.on]="$index <= ratingStepIdx()"></div>
              }
            </div>
            <div class="k-step-header-right">
              <button class="k-lang-pill" type="button" (click)="$event.stopPropagation(); toggleLang()">
                {{ s('langToggle') }}
              </button>
              <button class="k-step-skip" type="button" (click)="goTo('message')">Skip →</button>
            </div>
          </div>
          <div class="k-rating-content">
            <div class="k-rate-eyebrow">{{ s('ratingEyebrow') }}</div>
            <div class="k-rate-title" [innerHTML]="s('ratingTitle').replace('\\n','<br>')"></div>
            <div class="k-rating-pills">
              @for (pill of ratingPills(); track pill.value) {
                <button class="k-rating-pill"
                        type="button"
                        [class.on]="pill.value === (hoverRating() || rating())"
                        [attr.data-val]="pill.value"
                        (mouseenter)="hoverRating.set(pill.value)"
                        (mouseleave)="hoverRating.set(0)"
                        (click)="setRatingAndAdvance(pill.value)">
                  <span class="k-pill-num">{{ pill.value }}</span>
                  <span class="k-pill-label">{{ pill.label }}</span>
                </button>
              }
            </div>
            <div class="k-rating-track">
              <div class="k-rating-track-bar"></div>
              <div class="k-rating-track-ends">
                <span>{{ s('ratingPoor') }}</span>
                <span>{{ s('ratingExcellent') }}</span>
              </div>
            </div>
            <div class="k-rate-hint">{{ s('ratingHint') }}</div>
          </div>
        </div>
      }

      <!-- ── Screen 4: Message ──────────────────────────────────── -->
      @if (step() === 'message') {
        <div class="kiosk k-feedback">
          <div class="k-step-header">
            <img src="/assets/brand/elite-logo-cream.png" alt="Elite Collection" class="k-step-logo-img"/>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot" [class.on]="$index <= messageStepIdx()"></div>
              }
            </div>
            <div class="k-step-header-right">
              <button class="k-lang-pill" type="button" (click)="$event.stopPropagation(); toggleLang()">
                {{ s('langToggle') }}
              </button>
              <button class="k-step-skip" type="button" (click)="goTo('contact')">{{ s('messageSkip') }}</button>
            </div>
          </div>
          <div class="k-feedback-content">
            <div class="k-feedback-title">{{ s('messageTitle') }}</div>
            <div class="k-feedback-sub">{{ s('messageSub') }}</div>
            <textarea class="k-textarea"
                      [placeholder]="s('messagePlaceholder')"
                      maxlength="600"
                      [(ngModel)]="messageText"
                      (ngModelChange)="message.set($event)"></textarea>
            <div class="k-char-count">{{ message().length }} / 600</div>
            <div class="k-btns">
              <button class="k-btn-outline" type="button" (click)="goTo('contact')">{{ s('messageSkip') }}</button>
              <button class="k-btn-gold" type="button" (click)="goTo('contact')">{{ s('messageContinue') }} →</button>
            </div>
          </div>
        </div>
      }

      <!-- ── Screen 5: Contact ──────────────────────────────────── -->
      @if (step() === 'contact') {
        <div class="kiosk k-contact">
          <div class="k-step-header">
            <img src="/assets/brand/elite-logo-cream.png" alt="Elite Collection" class="k-step-logo-img"/>
            <div class="k-step-progress">
              @for (_ of steps; track $index) {
                <div class="k-step-dot on"></div>
              }
            </div>
            <div class="k-step-header-right">
              <button class="k-lang-pill" type="button" (click)="$event.stopPropagation(); toggleLang()">
                {{ s('langToggle') }}
              </button>
              <button class="k-step-skip" type="button" (click)="submit()">{{ s('contactSkip') }}</button>
            </div>
          </div>
          <div class="k-contact-content">
            <div class="k-contact-title">{{ s('contactTitle') }}</div>
            <div class="k-contact-sub" [innerHTML]="s('contactSub').replace('\\n','<br>')"></div>
            <div class="k-contact-grid">
              <div class="k-contact-field">
                <div class="k-contact-label">{{ s('contactName') }}</div>
                <input class="k-contact-input" [placeholder]="s('contactName')" type="text"
                       [(ngModel)]="contactNameText" (ngModelChange)="contactName.set($event)"/>
              </div>
              <div class="k-contact-field">
                <div class="k-contact-label">{{ s('contactPhone') }}</div>
                <input class="k-contact-input" placeholder="+974 XXXX XXXX" type="tel"
                       [(ngModel)]="contactPhoneText" (ngModelChange)="contactPhone.set($event)"/>
              </div>
              <div class="k-contact-field k-contact-full">
                <div class="k-contact-label">{{ s('contactEmail') }}</div>
                <input class="k-contact-input" placeholder="your@email.com" type="email"
                       [(ngModel)]="contactEmailText" (ngModelChange)="contactEmail.set($event)"/>
              </div>
            </div>
            <div class="k-skip-note">◇ &nbsp; {{ s('contactNote') }}</div>
            <div class="k-btns">
              <button class="k-btn-outline" type="button" (click)="submit()" [disabled]="submitting()">{{ s('contactSkip') }}</button>
              <button class="k-btn-gold" type="button" (click)="submit()" [disabled]="submitting()">
                {{ submitting() ? s('contactSending') : s('contactSubmit') + ' →' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- ── Screen 6: Thank you ────────────────────────────────── -->
      @if (step() === 'thanks') {
        <div class="kiosk k-thanks">
          <div class="k-thanks-bg"></div>
          <!-- Falling particles -->
          <div class="k-particles" aria-hidden="true">
            @for (p of particles(); track $index) {
              <div class="k-particle" [style]="p.style" [innerHTML]="p.html"></div>
            }
          </div>
          <div class="k-thanks-icon">✓</div>
          <div class="k-thanks-title">{{ s('thanksTitle') }}</div>
          <div class="k-thanks-sub">{{ s('thanksSub') }}</div>
          <button class="k-thanks-restart" type="button" (click)="restart()">
            {{ s('thanksRestart') }} &nbsp;↺
          </button>
          <div class="k-ring-wrap" aria-label="auto-restart countdown">
            <svg class="k-ring-svg" viewBox="0 0 60 60">
              <circle class="k-ring-track" cx="30" cy="30" r="26"/>
              <circle class="k-ring-fill"  cx="30" cy="30" r="26"
                      [style.stroke-dashoffset]="ringOffset()"/>
            </svg>
            <div class="k-ring-num">{{ countdown() }}</div>
          </div>
          <div class="k-ring-label">{{ s('thanksCountdown') }}</div>
        </div>
      }

    </div>
  `,
  styles: [`
    :host { display: block; width: 100vw; height: 100vh; overflow: hidden; }

    /* ── Shell ────────────────────────────── */
    .k-shell {
      width: 100%; height: 100%;
      font-family: 'Montserrat', sans-serif;
      position: relative;
    }

    .kiosk {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      overflow: hidden;
    }

    /* ── Language pill ────────────────────── */
    /* Always sits on the dark green header — keep it light/gold throughout */
    .k-lang-pill {
      font-family: 'Montserrat', sans-serif;
      font-size: clamp(11px,1.1vw,14px); font-weight: 700;
      letter-spacing: .12em; text-transform: uppercase;
      padding: clamp(7px,.9vw,11px) clamp(16px,1.8vw,24px);
      border-radius: 99px;
      border: 1.5px solid rgba(212,168,83,.55);
      background: rgba(212,168,83,.14);
      color: rgba(255,255,255,.92);
      cursor: pointer; transition: all .15s; white-space: nowrap;
      min-height: 40px; display: flex; align-items: center;
    }
    .k-lang-pill:hover {
      border-color: #d4a853;
      background: rgba(212,168,83,.26);
      color: #fff;
    }

    /* Welcome screen pill position */
    .k-lang-welcome {
      position: absolute; top: clamp(14px,2%,24px); inset-inline-end: clamp(16px,3%,36px);
      z-index: 2;
    }

    /* Step screen pill sits inside the header */
    .k-step-header-right {
      display: flex; align-items: center; gap: clamp(10px,1.4vw,18px);
    }

    /* ── Welcome ──────────────────────────── */
    .k-welcome {
      background: #024638;
      text-align: center;
      padding: clamp(24px,5%,80px);
    }
    .k-welcome-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 50% 30%, rgba(184,146,74,.18), transparent 60%);
      pointer-events: none;
    }
    .k-logo-img {
      height: clamp(48px,6.5vw,88px); width: auto;
      object-fit: contain; position: relative; z-index: 1; margin-bottom: 6px;
    }
    .k-logo-sub {
      font-size: clamp(9px,1.1vw,13px); font-weight: 700;
      letter-spacing: .24em; text-transform: uppercase;
      color: rgba(184,146,74,.5); position: relative; z-index: 1; margin-bottom: 16px;
    }
    .k-diamond-line { position: relative; z-index: 1; margin-bottom: 18px; }
    .k-diamond { color: rgba(184,146,74,.45); font-size: 22px; }
    .k-welcome-title {
      font-size: clamp(22px,3.5vw,52px); font-weight: 300; color: #fff;
      line-height: 1.4; margin-bottom: 14px; position: relative; z-index: 1;
    }
    .k-welcome-sub {
      font-size: clamp(12px,1.5vw,20px); color: rgba(255,255,255,.45);
      line-height: 1.75; margin-bottom: clamp(28px,4.5%,52px);
      position: relative; z-index: 1; max-width: 620px;
    }
    .k-start-btn {
      padding: clamp(16px,2.2%,26px) clamp(44px,6%,88px);
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      border: none; border-radius: 5px;
      color: #0d0b08; font-size: clamp(12px,1.5vw,18px);
      font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
      cursor: pointer; font-family: inherit;
      box-shadow: 0 10px 36px rgba(184,146,74,.4);
      position: relative; z-index: 1; margin-bottom: clamp(20px,3.5%,40px);
      transition: transform .14s, box-shadow .14s;
    }
    .k-start-btn:hover { transform: translateY(-2px); box-shadow: 0 16px 44px rgba(184,146,74,.5); }
    .k-privacy {
      font-size: clamp(10px,1vw,13px); color: rgba(255,255,255,.2);
      position: relative; z-index: 1;
    }

    /* ── Step header ──────────────────────── */
    .k-step-header {
      position: absolute; top: 0; left: 0; right: 0;
      background: #024638; padding: clamp(12px,2%,20px) clamp(20px,3%,44px);
      display: flex; align-items: center; justify-content: space-between;
      z-index: 10; min-height: clamp(56px,8vh,72px);
    }
    .k-step-logo-img {
      height: clamp(28px,3.5vw,48px); width: auto; object-fit: contain;
    }
    .k-step-progress { display: flex; gap: clamp(8px,1.2vw,14px); align-items: center; }
    .k-step-dot {
      width: clamp(9px,1.1vw,13px); height: clamp(9px,1.1vw,13px); border-radius: 50%;
      background: rgba(255,255,255,.18); transition: background .2s, transform .2s;
    }
    .k-step-dot.on { background: #d4a853; transform: scale(1.25); }
    .k-step-skip {
      font-size: clamp(11px,1.2vw,14px); font-weight: 700; letter-spacing: .1em;
      text-transform: uppercase;
      color: rgba(255,255,255,.5);
      background: none;
      border: 1px solid rgba(255,255,255,.2);
      border-radius: 4px;
      padding: clamp(7px,.9vw,11px) clamp(14px,1.8vw,22px);
      cursor: pointer; font-family: inherit;
      transition: all .15s; white-space: nowrap;
      min-height: 40px;
    }
    .k-step-skip:hover {
      color: rgba(255,255,255,.9);
      background: rgba(255,255,255,.1);
      border-color: rgba(255,255,255,.4);
    }

    /* ── Product picker ───────────────────── */
    .k-product { background: #eee9df; }
    .k-product-content {
      display: flex; flex-direction: column;
      padding: clamp(68px,9%,100px) clamp(28px,4%,64px) clamp(20px,3%,40px);
      width: 100%; max-width: 1060px;
      overflow-y: auto; max-height: 100vh; box-sizing: border-box;
    }
    .k-product-header {
      text-align: center;
      padding-bottom: clamp(16px,2.5%,28px);
      border-bottom: 1px solid rgba(0,0,0,.07);
      margin-bottom: clamp(16px,2.5%,28px);
      flex-shrink: 0;
    }
    .k-product-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: clamp(12px,1.8%,22px);
    }
    @media (max-width: 900px) { .k-product-grid { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 600px) { .k-product-grid { grid-template-columns: repeat(2, 1fr); } }
    .k-product-card {
      border: 1.5px solid rgba(0,0,0,.07); border-radius: 8px;
      background: #fff; padding: clamp(10px,1.2%,16px) clamp(10px,1.2%,16px) clamp(12px,1.5%,18px);
      cursor: pointer; font-family: inherit; transition: all .18s;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,.04);
    }
    .k-product-card:hover {
      border-color: rgba(184,146,74,.5);
      transform: translateY(-3px);
      box-shadow: 0 10px 32px rgba(0,0,0,.1);
    }
    .k-product-card.on {
      border-color: #b8924a;
      box-shadow: 0 0 0 2px #b8924a, 0 10px 32px rgba(184,146,74,.18);
    }
    .k-product-img-wrap {
      position: relative; width: 100%;
    }
    .k-product-img {
      width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 5px;
      display: block;
    }
    .k-product-placeholder {
      width: 100%; aspect-ratio: 1 / 1; display: flex; align-items: center;
      justify-content: center; font-size: clamp(28px,4vw,44px); color: #b8924a;
      background: rgba(184,146,74,.06); border-radius: 5px;
    }
    .k-product-check {
      position: absolute; top: 8px; right: 8px;
      width: clamp(24px,2.8vw,34px); height: clamp(24px,2.8vw,34px);
      border-radius: 50%;
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: clamp(12px,1.4vw,17px); font-weight: 700;
      box-shadow: 0 3px 10px rgba(184,146,74,.45);
    }
    .k-product-name {
      font-size: clamp(11px,1.3vw,16px); font-weight: 600; color: #1a1208;
      text-align: center; line-height: 1.35; width: 100%;
    }

    /* ── Empty products ───────────────────── */
    .k-empty-products {
      display: flex; flex-direction: column; align-items: center;
      gap: 8px; padding: clamp(24px,4%,48px) 0;
    }
    .k-empty-icon { font-size: 36px; color: rgba(184,146,74,.35); margin-bottom: 4px; }
    .k-empty-text { font-size: clamp(13px,1.6vw,18px); font-weight: 600; color: #1a1208; }
    .k-empty-sub  { font-size: clamp(10px,1.2vw,14px); color: #8a7a62; font-style: italic; }

    /* ── Rating ───────────────────────────── */
    .k-rating { background: #eee9df; }
    .k-rating-content {
      text-align: center;
      padding: clamp(72px,11%,120px) clamp(24px,3%,48px) clamp(24px,4%,60px);
      width: 100%; max-width: 960px;
    }
    .k-rate-eyebrow {
      font-size: clamp(10px,1.1vw,14px); font-weight: 700; letter-spacing: .22em;
      text-transform: uppercase; color: #b8924a; margin-bottom: 12px;
    }
    .k-rate-title {
      font-size: clamp(24px,3.5vw,48px); font-weight: 600; color: #1a1208;
      line-height: 1.35; margin-bottom: clamp(28px,5%,56px);
    }
    .k-rating-pills {
      display: flex; flex-wrap: nowrap;
      gap: clamp(8px,1.2vw,14px);
      width: 100%; max-width: 820px; margin: 0 auto clamp(14px,2%,22px);
    }
    .k-rating-pill {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; align-items: center;
      gap: clamp(5px,.7vw,8px);
      padding: clamp(14px,2vw,22px) clamp(6px,.8vw,10px);
      border: 1.5px solid rgba(0,0,0,.1); border-radius: 8px;
      background: rgba(255,255,255,.6); color: #8a7a62;
      font-family: inherit; cursor: pointer; transition: all .18s;
      user-select: none;
    }
    .k-rating-pill:hover {
      border-color: rgba(184,146,74,.6);
      background: rgba(255,255,255,.9);
      transform: translateY(-3px);
      box-shadow: 0 8px 24px rgba(0,0,0,.08);
    }
    .k-rating-pill.on {
      background: #024638; border-color: #024638; color: #d4a853;
      box-shadow: 0 8px 28px rgba(2,70,56,.28); transform: translateY(-3px);
    }
    .k-pill-num {
      font-size: clamp(22px,3vw,40px); font-weight: 300;
      font-family: 'Cormorant Garamond','Georgia',serif;
      line-height: 1; color: inherit;
    }
    .k-pill-label {
      font-size: clamp(8px,.85vw,11px); font-weight: 700;
      letter-spacing: .1em; text-transform: uppercase; color: inherit;
      white-space: nowrap; text-align: center;
    }
    .k-rating-track {
      width: 100%; max-width: 820px; margin: 0 auto clamp(18px,3%,32px);
    }
    .k-rating-track-bar {
      height: 3px; border-radius: 99px;
      background: linear-gradient(to right, rgba(184,146,74,.15) 0%, #b8924a 100%);
      margin-bottom: 8px;
    }
    .k-rating-track-ends {
      display: flex; justify-content: space-between;
      font-size: clamp(9px,1vw,12px); font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase; color: #8a7a62;
    }
    .k-rate-hint {
      font-size: clamp(11px,1.2vw,15px); color: #b8924a;
      margin-bottom: clamp(16px,3%,36px); font-style: italic;
    }

    /* ── Message ──────────────────────────── */
    .k-feedback { background: #eee9df; }
    .k-feedback-content {
      text-align: center;
      padding: clamp(72px,11%,120px) clamp(24px,5%,80px) clamp(24px,4%,60px);
      width: 100%; max-width: 780px;
    }
    .k-feedback-title {
      font-size: clamp(24px,3.2vw,44px); font-weight: 700; color: #1a1208; margin-bottom: 8px;
    }
    .k-feedback-sub {
      font-size: clamp(13px,1.5vw,19px); color: #8a7a62;
      margin-bottom: clamp(24px,3.5%,44px);
    }
    .k-textarea {
      width: 100%; height: clamp(130px,18vh,240px);
      padding: clamp(18px,2.2%,26px); border: 1.5px solid rgba(0,0,0,.1);
      border-radius: 8px; font-size: clamp(15px,1.8vw,22px);
      font-family: inherit; resize: none;
      background: rgba(255,255,255,.75); color: #1a1208;
      transition: border-color .2s, box-shadow .2s; margin-bottom: 8px;
      line-height: 1.65;
    }
    .k-textarea:focus {
      outline: none; border-color: #b8924a; background: #fff;
      box-shadow: 0 0 0 4px rgba(184,146,74,.1);
    }
    .k-char-count {
      text-align: end; font-size: clamp(11px,1.1vw,15px); color: #8a7a62;
      margin-bottom: clamp(20px,3%,36px);
    }

    /* ── Contact ──────────────────────────── */
    .k-contact { background: #eee9df; }
    .k-contact-content {
      text-align: center;
      padding: clamp(72px,11%,120px) clamp(24px,5%,80px) clamp(24px,4%,60px);
      width: 100%; max-width: 760px;
    }
    .k-contact-title {
      font-size: clamp(24px,3.2vw,44px); font-weight: 700; color: #1a1208; margin-bottom: 8px;
    }
    .k-contact-sub {
      font-size: clamp(13px,1.4vw,18px); color: #8a7a62; line-height: 1.7;
      margin-bottom: clamp(24px,3.5%,44px);
    }
    .k-contact-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: clamp(12px,1.8vw,22px); margin-bottom: clamp(16px,2%,24px);
      text-align: start;
    }
    @media (max-width: 600px) { .k-contact-grid { grid-template-columns: 1fr; } }
    .k-contact-full { grid-column: 1 / -1; }
    .k-contact-field { display: flex; flex-direction: column; gap: 8px; }
    .k-contact-label {
      font-size: clamp(10px,1.1vw,14px); font-weight: 700;
      letter-spacing: .16em; text-transform: uppercase; color: #8a7a62;
    }
    .k-contact-input {
      padding: clamp(14px,2%,22px) clamp(16px,2.2%,24px);
      border: 1.5px solid rgba(0,0,0,.1); border-radius: 6px;
      font-size: clamp(15px,1.8vw,22px); font-family: inherit;
      background: rgba(255,255,255,.75); color: #1a1208;
      transition: border-color .2s, box-shadow .2s;
    }
    .k-contact-input:focus {
      outline: none; border-color: #b8924a; background: #fff;
      box-shadow: 0 0 0 4px rgba(184,146,74,.1);
    }
    .k-skip-note {
      font-size: clamp(11px,1.1vw,14px); color: rgba(26,18,8,.38);
      margin-bottom: clamp(20px,3%,36px);
    }

    /* ── Shared buttons ───────────────────── */
    .k-btns { display: flex; gap: clamp(12px,1.8%,20px); justify-content: center; margin-top: clamp(16px,2.5%,28px); }
    .k-btn-outline {
      padding: clamp(14px,2%,22px) clamp(28px,4%,64px);
      background: transparent; border: 1.5px solid rgba(0,0,0,.14);
      border-radius: 5px; color: #8a7a62;
      font-size: clamp(11px,1.3vw,17px); font-weight: 700;
      letter-spacing: .14em; text-transform: uppercase;
      cursor: pointer; font-family: inherit; transition: all .14s;
    }
    .k-btn-outline:hover { border-color: #b8924a; color: #b8924a; }
    .k-btn-gold {
      padding: clamp(14px,2%,22px) clamp(32px,5%,72px);
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      border: none; border-radius: 5px; color: #0d0b08;
      font-size: clamp(11px,1.3vw,17px); font-weight: 700;
      letter-spacing: .15em; text-transform: uppercase;
      cursor: pointer; font-family: inherit; transition: transform .14s, box-shadow .14s;
      box-shadow: 0 4px 16px rgba(184,146,74,.28);
    }
    .k-btn-gold:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(184,146,74,.38); }
    .k-btn-gold:disabled { opacity: .5; cursor: not-allowed; }

    /* ── Thank you ────────────────────────── */
    .k-thanks {
      background: #024638; text-align: center;
      padding: clamp(24px,5%,80px);
    }
    .k-thanks-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 50% 40%, rgba(184,146,74,.18), transparent 60%);
      pointer-events: none;
    }
    .k-thanks-icon {
      width: clamp(68px,9vw,104px); height: clamp(68px,9vw,104px);
      border-radius: 50%;
      background: linear-gradient(135deg,#c9a96e,#9a7535);
      display: flex; align-items: center; justify-content: center;
      font-size: clamp(28px,4vw,48px); color: #fff;
      margin-bottom: clamp(20px,3.5%,40px);
      position: relative; z-index: 1;
      box-shadow: 0 12px 40px rgba(184,146,74,.5);
    }
    .k-thanks-title {
      font-family: 'Cormorant Garamond','Georgia',serif;
      font-size: clamp(40px,7vw,88px); font-style: italic;
      font-weight: 400; color: #d4a853;
      margin-bottom: 16px; position: relative; z-index: 1;
    }
    .k-thanks-sub {
      font-size: clamp(13px,1.6vw,22px); color: rgba(255,255,255,.5);
      line-height: 1.8; max-width: 580px; margin-bottom: clamp(28px,4.5%,56px);
      position: relative; z-index: 1;
    }
    .k-thanks-restart {
      padding: clamp(14px,2%,20px) clamp(32px,5%,64px);
      background: rgba(255,255,255,.08); border: 1.5px solid rgba(255,255,255,.22);
      border-radius: 5px; color: rgba(255,255,255,.75);
      font-size: clamp(11px,1.2vw,16px); font-weight: 700; letter-spacing: .18em;
      text-transform: uppercase; cursor: pointer; font-family: inherit;
      position: relative; z-index: 1; margin-bottom: clamp(16px,2.5%,28px);
      transition: all .15s;
    }
    .k-thanks-restart:hover { background: rgba(255,255,255,.18); color: #fff; }
    .k-ring-wrap {
      position: relative; width: clamp(76px,9vw,104px); height: clamp(76px,9vw,104px);
      margin: clamp(16px,2.5%,32px) auto 8px; z-index: 1;
    }
    .k-ring-svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .k-ring-track {
      fill: none; stroke: rgba(255,255,255,.08); stroke-width: 2.5;
    }
    .k-ring-fill {
      fill: none; stroke: #d4a853; stroke-width: 2.5;
      stroke-linecap: round;
      stroke-dasharray: 163.36;
      stroke-dashoffset: 0;
      transition: stroke-dashoffset 0.9s linear;
    }
    .k-ring-num {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cormorant Garamond','Georgia',serif;
      font-size: clamp(22px,3.2vw,34px); font-style: italic;
      color: #d4a853; font-weight: 400;
    }
    .k-ring-label {
      font-size: clamp(10px,1vw,13px); letter-spacing: .18em; text-transform: uppercase;
      color: rgba(255,255,255,.22); position: relative; z-index: 1;
      margin-bottom: 4px;
    }

    /* ── Falling particles ────────────────── */
    .k-particles {
      position: absolute; inset: 0; overflow: hidden;
      pointer-events: none; z-index: 2;
    }
    .k-particle {
      position: absolute; top: 0;
      color: rgba(212,168,83,.5);
      animation: k-fall linear infinite;
      will-change: transform, opacity;
      display: flex; align-items: center; justify-content: center;
    }
    .k-particle svg { display: block; }
    @keyframes k-fall {
      0%   { transform: translateY(-70px) translateX(0px) rotate(0deg); opacity: 0; }
      8%   { opacity: .8; }
      30%  { transform: translateY(28vh) translateX(var(--sw, 20px)) rotate(115deg); }
      55%  { transform: translateY(55vh) translateX(calc(var(--sw, 20px) * -0.8)) rotate(235deg); }
      80%  { opacity: .55; }
      100% { transform: translateY(108vh) translateX(calc(var(--sw, 20px) * 0.5)) rotate(360deg); opacity: 0; }
    }

    /* ── Loading dots ─────────────────────── */
    .k-loading-dots {
      display: flex; gap: 8px; justify-content: center; margin: 32px 0;
    }
    .k-loading-dots span {
      width: 10px; height: 10px; border-radius: 50%; background: #b8924a;
      animation: dot-pulse 1.4s ease-in-out infinite;
    }
    .k-loading-dots span:nth-child(2) { animation-delay: .2s; }
    .k-loading-dots span:nth-child(3) { animation-delay: .4s; }
    @keyframes dot-pulse { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
  `],
})
export class KioskComponent implements OnInit, OnDestroy {
  private readonly route     = inject(ActivatedRoute);
  private readonly http      = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  // ── Lang ───────────────────────────────────────────────────
  readonly lang = signal<KioskLang>('en');
  s = (key: string): string => STRINGS[this.lang()][key] ?? key;
  toggleLang(): void {
    this.lang.update((l) => l === 'en' ? 'ar' : 'en');
  }

  // ── State ──────────────────────────────────────────────────
  readonly step              = signal<KioskStep>('welcome');
  readonly products          = signal<KioskProduct[]>([]);
  readonly loadingProducts   = signal(false);
  readonly selectedProductId = signal<string | null>(null);
  readonly rating            = signal(0);
  readonly hoverRating       = signal(0);
  readonly message           = signal('');
  readonly contactName       = signal('');
  readonly contactPhone      = signal('');
  readonly contactEmail      = signal('');
  readonly submitting        = signal(false);
  readonly countdown         = signal(5);
  readonly particles         = signal<Particle[]>([]);
  readonly ringOffset        = computed(() => 163.36 * (1 - this.countdown() / 5));
  readonly ratingPills       = computed(() => [
    { value: 1, label: this.s('ratingVal1') },
    { value: 2, label: this.s('ratingVal2') },
    { value: 3, label: this.s('ratingVal3') },
    { value: 4, label: this.s('ratingVal4') },
    { value: 5, label: this.s('ratingVal5') },
  ]);

  messageText      = '';
  contactNameText  = '';
  contactPhoneText = '';
  contactEmailText = '';

  steps: number[] = [];

  private preselectedProductId: string | null = null;
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  private readonly apiBase = (() => {
    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    return isLocal
      ? `${window.location.protocol}//${window.location.hostname}:3000/api`
      : '/api';
  })();

  async ngOnInit(): Promise<void> {
    this.preselectedProductId = this.route.snapshot.queryParamMap.get('product');
    if (this.preselectedProductId) {
      this.selectedProductId.set(this.preselectedProductId);
      this.steps = [0, 1, 2];
    } else {
      this.steps = [0, 1, 2, 3];
      this.loadingProducts.set(true);
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 6000),
        );
        const fetch = firstValueFrom(
          this.http.get<ApiEnvelope<KioskProduct[]>>(`${this.apiBase}/products`),
        );
        const res = await Promise.race([fetch, timeout]);
        this.products.set(Array.isArray(res.data) ? res.data : []);
      } catch {
        this.products.set([]);
      } finally {
        this.loadingProducts.set(false);
      }
    }
  }

  ngOnDestroy(): void { this.clearTimers(); }

  // ── Step index helpers ─────────────────────────────────────
  ratingStepIdx():  number { return this.preselectedProductId ? 0 : 1; }
  messageStepIdx(): number { return this.preselectedProductId ? 1 : 2; }

  // ── Navigation ─────────────────────────────────────────────
  startFlow(): void {
    if (this.preselectedProductId) {
      this.step.set('rating');
    } else {
      this.step.set(this.products().length > 0 ? 'product' : 'rating');
    }
    this.startActivity();
  }

  goTo(next: KioskStep): void {
    this.step.set(next);
    this.resetActivity();
  }

  // Auto-advance to rating immediately on product tap
  selectAndAdvance(id: string): void {
    this.selectedProductId.set(id);
    setTimeout(() => this.goTo('rating'), 120);
  }

  skipProduct(): void {
    this.selectedProductId.set(null);
    this.goTo('rating');
  }

  // Rating tap auto-advances to message
  setRatingAndAdvance(n: number): void {
    this.rating.set(n);
    setTimeout(() => this.goTo('message'), 350);
  }

  // ── Submit ─────────────────────────────────────────────────
  async submit(): Promise<void> {
    if (this.submitting()) return;
    const pid = this.selectedProductId();

    this.submitting.set(true);
    try {
      const endpoint = pid
        ? `${this.apiBase}/products/${pid}/reviews`
        : `${this.apiBase}/reviews`;

      const bodyText = this.message().trim() || null;

      await firstValueFrom(
        this.http.post(endpoint, {
          rating:      this.rating() || null,
          body:        pid ? (bodyText ?? 'No message provided.') : bodyText,
          authorName:  this.contactName().trim()  || null,
          authorPhone: this.contactPhone().trim() || null,
          authorEmail: this.contactEmail().trim() || null,
          source:      'kiosk',
        }),
      );
    } catch { /* silent — still show thanks */ } finally {
      this.submitting.set(false);
      this.goTo('thanks');
      this.startCountdown();
      this.spawnParticles();
    }
  }

  private spawnParticles(): void {
    const count = 28;
    const list: Particle[] = Array.from({ length: count }, (_, i) => {
      const svg   = PARTICLE_ICONS[i % PARTICLE_ICONS.length];
      const x     = Math.round(Math.random() * 94);
      const dur   = (3.5 + Math.random() * 5).toFixed(1);
      const delay = (Math.random() * 8).toFixed(1);
      const sw    = Math.round(12 + Math.random() * 28);
      const sz    = Math.round(13 + Math.random() * 20);
      return {
        html:  this.sanitizer.bypassSecurityTrustHtml(svg),
        style: `left:${x}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:-${delay}s;--sw:${sw}px`,
      };
    });
    this.particles.set(list);
  }

  // ── Restart ────────────────────────────────────────────────
  restart(): void {
    this.clearTimers();
    this.rating.set(0);
    this.hoverRating.set(0);
    this.message.set('');      this.messageText = '';
    this.contactName.set('');  this.contactNameText = '';
    this.contactPhone.set(''); this.contactPhoneText = '';
    this.contactEmail.set(''); this.contactEmailText = '';
    this.selectedProductId.set(this.preselectedProductId);
    this.countdown.set(5);
    this.particles.set([]);
    this.step.set('welcome');
  }

  // ── Activity / auto-reset ──────────────────────────────────
  @HostListener('document:touchstart')
  @HostListener('document:click')
  resetActivity(): void {
    if (this.step() !== 'welcome' && this.step() !== 'thanks') {
      this.startActivity();
    }
  }

  private startActivity(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => this.restart(), 60_000);
  }

  private startCountdown(): void {
    this.countdown.set(5);
    this.countdownInterval = setInterval(() => {
      const v = this.countdown() - 1;
      this.countdown.set(v);
      if (v <= 0) { this.restart(); }
    }, 1000);
  }

  private clearTimers(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.countdownInterval) clearInterval(this.countdownInterval);
  }
}
