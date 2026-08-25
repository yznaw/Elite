import {
  Component, OnInit, OnDestroy, inject, signal, computed, HostListener,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { I18nService } from '../../services/i18n.service';
import { SeoService } from '../../services/seo.service';
import { firstValueFrom } from 'rxjs';

type ExperienceView = 'main' | 'thanks';
type ExperienceLang = 'en' | 'ar';

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

// ── All UI strings in both languages ─────────────────────────────────────────
const STRINGS: Record<ExperienceLang, Record<string, any>> = {
  en: {
    logoSub: 'Arabic Leather Artisans',
    welcomeTitle: 'Excellence is in the details.',
    welcomeSub: 'We\'d love your thoughts on today\'s visit.',

    ratingEyebrow: 'Your Rating',
    ratingTitle: 'How was your experience?',
    ratingPoor: 'Poor',
    ratingExcellent: 'Exceptional',
    ratingVal1: 'Poor',
    ratingVal2: 'Fair',
    ratingVal3: 'Good',
    ratingVal4: 'Great',
    ratingVal5: 'Exceptional',

    feedbackPrompt: 'Tell us more',
    feedbackSub: 'How can we improve? (Select all that apply)',
    feedbackOptions: ['Staff Greeting', 'Wait Time', 'Store Cleanliness', 'Product Display', 'Staff Helpfulness', 'Store Ambiance'],
    feedbackSubmit: 'Submit',
    feedbackSubmitIn: 'Submitting in',
    feedbackSending: 'Sending…',

    privacy: 'Your feedback is private and helps us improve.',

    thanksTitle: 'Thank you!',
    thanksSub: 'We appreciate your time and feedback.',
    thanksRestart: 'New Rating',
    thanksCountdown: 'The screen will refresh soon',

    langToggle: 'عربي',
  },
  ar: {
    logoSub: 'حِرَفيّو الجِلد العربي',
    welcomeTitle: 'التميز يكمن في التفاصيل.',
    welcomeSub: 'يسعدنا الاستماع لرأيك حول زيارتك اليوم.',

    ratingEyebrow: 'تقييمك',
    ratingTitle: 'كيف كانت تجربتك معنا؟',
    ratingPoor: 'غير مُرضي',
    ratingExcellent: 'استثنائي',
    ratingVal1: 'غير مُرضي',
    ratingVal2: 'مقبول',
    ratingVal3: 'جيد',
    ratingVal4: 'رائع',
    ratingVal5: 'استثنائي',

    feedbackPrompt: 'أخبرنا المزيد',
    feedbackSub: 'كيف يمكننا التحسن؟ (اختر ما يناسبك)',
    feedbackOptions: ['الاستقبال', 'وقت الانتظار', 'نظافة المكان', 'عرض المنتجات', 'تعاون الموظفين', 'أجواء المعرض'],
    feedbackSubmit: 'إرسال',
    feedbackSubmitIn: 'سيتم الإرسال خلال',
    feedbackSending: 'جارٍ الإرسال…',

    privacy: 'رأيك بسرية تامة ويساعدنا على التطور.',

    thanksTitle: 'شكراً لك!',
    thanksSub: 'نقدر وقتك ومشاركتك.',
    thanksRestart: 'تقييم جديد',
    thanksCountdown: 'سيتم تحديث الشاشة قريباً',

    langToggle: 'English',
  },
};

@Component({
    selector: 'app-experience',
    imports: [CommonModule, FormsModule],
    template: `
    <div class="k-shell" [attr.dir]="lang() === 'ar' ? 'rtl' : 'ltr'"
         (click)="resetActivity()" (touchstart)="resetActivity()">

      <!-- ── Main: Single-page rating ──────────────────────────── -->
      @if (view() === 'main') {
        <div class="experience k-main">
          <div class="k-main-bg"></div>

          <!-- Top bar: logo + lang toggle -->
          <div class="k-topbar">
            <img src="/assets/brand/elite-logo-cream.png" alt="Elite Collection" class="k-topbar-logo"/>
            <button class="k-lang-pill" type="button" (click)="$event.stopPropagation(); toggleLang()">
              {{ s('langToggle') }}
            </button>
          </div>

          <!-- Scrollable content area -->
          <div class="k-main-scroll">
            <div class="k-main-content">

              <!-- Welcome message -->
              <div class="k-diamond-line"><span class="k-diamond">◇</span></div>
              <h1 class="k-welcome-title" [innerHTML]="nl2br(s('welcomeTitle'))"></h1>
              <p class="k-welcome-sub" [innerHTML]="nl2br(s('welcomeSub'))"></p>

              <!-- Rating section -->
              <div class="k-rate-eyebrow">{{ s('ratingEyebrow') }}</div>
              <div class="k-rating-pills">
                @for (pill of ratingPills(); track pill.value) {
                  <button class="k-rating-pill"
                          type="button"
                          [class.on]="pill.value === (hoverRating() || rating())"
                          [class.low]="pill.value <= 3 && pill.value === (hoverRating() || rating())"
                          [attr.data-val]="pill.value"
                          (mouseenter)="hoverRating.set(pill.value)"
                          (mouseleave)="hoverRating.set(0)"
                          (click)="selectRating(pill.value)">
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

              <!-- Feedback options — slides in when rating <= 3 -->
              @if (showFeedback()) {
                <div class="k-feedback-area" [class.visible]="showFeedback()">
                  <div class="k-feedback-divider">
                    <span class="k-feedback-divider-diamond">◇</span>
                  </div>
                  <div class="k-feedback-prompt">{{ s('feedbackPrompt') }}</div>
                  <div class="k-feedback-sub">{{ s('feedbackSub') }}</div>
                  
                  <div class="k-feedback-chips">
                    @for (opt of options(); track opt) {
                      <button class="k-chip"
                              type="button"
                              [class.selected]="selectedOptions().includes(opt)"
                              (click)="toggleOption(opt)">
                        {{ opt }}
                      </button>
                    }
                  </div>

                  <button class="k-btn-gold" type="button"
                          (click)="submit()" [disabled]="submitting()">
                    {{ submitting() ? s('feedbackSending') : s('feedbackSubmit') + ' →' }}
                  </button>

                  @if (lowRatingCountdown() > 0 && !submitting()) {
                    <div class="k-auto-submit-hint">
                      {{ s('feedbackSubmitIn') }} {{ lowRatingCountdown() }}s
                    </div>
                  }
                </div>
              }

              <!-- Auto submit message for rating >= 4 -->
              @if (autoSubmitting()) {
                <div class="k-auto-submit-msg">
                  <span class="k-spinner"></span>
                  {{ s('feedbackSending') }}
                </div>
              }

              <!-- Privacy note -->
              <div class="k-privacy">◇ &nbsp; {{ s('privacy') }}</div>
            </div>
          </div>
        </div>
      }

      <!-- ── Thank you ────────────────────────────────────────── -->
      @if (view() === 'thanks') {
        <div class="experience k-thanks">
          <div class="k-thanks-bg"></div>
          <!-- Falling particles -->
          <div class="k-particles" aria-hidden="true">
            @for (p of particles(); track $index) {
              <div class="k-particle" [style]="p.style" [innerHTML]="p.html"></div>
            }
          </div>
          <div class="k-thanks-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 13l4 4L19 7"/></svg>
          </div>
          <div class="k-thanks-title">{{ s('thanksTitle') }}</div>
          <div class="k-thanks-sub" [innerHTML]="nl2br(s('thanksSub'))"></div>
          
          <button class="k-thanks-restart" type="button" (click)="restart()">
            {{ s('thanksRestart') }}
          </button>
          
          <div class="k-thanks-timeout">
            {{ s('thanksCountdown') }} <span class="k-timeout-num">{{ countdown() }}</span>
          </div>
        </div>
      }

    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    :host { display: block; width: 100vw; height: 100vh; height: 100dvh; overflow: hidden; }

    /* ── Shell ────────────────────────────── */
    .k-shell {
      width: 100%; height: 100%;
      font-family: 'Montserrat', sans-serif;
      position: relative;
    }

    .experience {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center;
      overflow: hidden;
    }

    /* ── Language pill ────────────────────── */
    .k-lang-pill {
      font-family: 'Montserrat', sans-serif;
      font-size: clamp(11px, 1.1vw, 14px); font-weight: 700;
      letter-spacing: .12em; text-transform: uppercase;
      padding: clamp(7px, .9vw, 11px) clamp(16px, 1.8vw, 24px);
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

    /* ── Top bar ──────────────────────────── */
    .k-topbar {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; justify-content: space-between;
      padding: clamp(14px, 2.5%, 24px) clamp(20px, 4%, 44px);
      z-index: 10;
    }
    .k-topbar-logo {
      height: clamp(32px, 4.5vw, 56px); width: auto;
      object-fit: contain;
    }

    /* ── Main page ───────────────────────── */
    .k-main {
      background: #024638;
      text-align: center;
    }
    .k-main-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 50% 35%, rgba(184,146,74,.18), transparent 60%);
      pointer-events: none;
    }

    .k-main-scroll {
      position: absolute; inset: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      display: flex; justify-content: center;
    }

    .k-main-content {
      position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: center;
      width: 100%;
      max-width: 900px;
      padding: clamp(80px, 12vh, 130px) clamp(20px, 5vw, 48px) clamp(32px, 5vh, 60px);
      box-sizing: border-box;
    }

    /* ── Welcome section ─────────────────── */
    .k-diamond-line { margin-bottom: clamp(12px, 2vh, 20px); }
    .k-diamond { color: rgba(184,146,74,.45); font-size: clamp(18px, 2.5vw, 24px); }

    .k-welcome-title {
      font-size: clamp(20px, 4.5vw, 52px); font-weight: 300; color: #fff;
      line-height: 1.35; margin: 0 0 clamp(8px, 1.5vh, 14px);
      white-space: nowrap;
    }
    .k-welcome-sub {
      font-size: clamp(13px, 1.6vw, 19px); color: rgba(255,255,255,.45);
      line-height: 1.75; margin: 0 0 clamp(24px, 4vh, 44px);
      max-width: 520px;
    }

    /* ── Rating section ──────────────────── */
    .k-rate-eyebrow {
      font-size: clamp(10px, 1.1vw, 13px); font-weight: 700; letter-spacing: .22em;
      text-transform: uppercase; color: #b8924a;
      margin-bottom: clamp(14px, 2.5vh, 24px);
    }

    .k-rating-pills {
      display: flex; flex-wrap: nowrap;
      gap: clamp(8px, 1.5vw, 14px);
      width: 100%; max-width: 820px;
      margin: 0 auto clamp(12px, 2vh, 20px);
    }

    .k-rating-pill {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; align-items: center;
      gap: clamp(4px, .6vw, 8px);
      padding: clamp(14px, 2.5vw, 24px) clamp(6px, 1vw, 12px);
      border: 1.5px solid rgba(255,255,255,.12); border-radius: 10px;
      background: rgba(255,255,255,.06); color: rgba(255,255,255,.5);
      font-family: inherit; cursor: pointer; transition: all .2s ease;
      user-select: none;
      min-height: 48px;
    }
    .k-rating-pill:hover {
      border-color: rgba(212,168,83,.5);
      background: rgba(212,168,83,.12);
      transform: translateY(-3px);
      box-shadow: 0 8px 24px rgba(0,0,0,.15);
    }
    .k-rating-pill.on {
      background: linear-gradient(135deg, #c9a96e, #9a7535);
      border-color: transparent;
      color: #0d0b08;
      box-shadow: 0 8px 32px rgba(184,146,74,.45);
      transform: translateY(-4px) scale(1.05);
    }

    .k-pill-num {
      font-size: clamp(28px, 4vw, 48px); font-weight: 300;
      font-family: 'Cormorant Garamond', 'Georgia', serif;
      line-height: 1; color: inherit;
    }
    .k-pill-label {
      font-size: clamp(8px, 1.1vw, 13px); font-weight: 700;
      letter-spacing: .08em; text-transform: uppercase; color: inherit;
      white-space: normal; text-align: center;
      line-height: 1.2; max-width: 100%;
    }

    .k-rating-track {
      width: 100%; max-width: 820px; margin: 0 auto clamp(16px, 3vh, 28px);
    }
    .k-rating-track-bar {
      height: 2px; border-radius: 99px;
      background: linear-gradient(to right, rgba(184,146,74,.12) 0%, rgba(184,146,74,.4) 100%);
      margin-bottom: 8px;
    }
    .k-rating-track-ends {
      display: flex; justify-content: space-between;
      font-size: clamp(9px, 1vw, 12px); font-weight: 700;
      letter-spacing: .12em; text-transform: uppercase;
      color: rgba(255,255,255,.25);
    }

    /* ── Feedback area (conditional, rating <= 3) ── */
    .k-feedback-area {
      width: 100%; max-width: 560px;
      animation: k-slide-in .4s cubic-bezier(.22,1,.36,1) both;
      margin-bottom: clamp(16px, 3vh, 28px);
    }

    @keyframes k-slide-in {
      0% { opacity: 0; transform: translateY(16px); }
      100% { opacity: 1; transform: translateY(0); }
    }

    .k-auto-submit-hint {
      margin-top: clamp(10px, 1.6vh, 16px);
      font-size: clamp(11px, 1.2vw, 14px);
      color: rgba(255,255,255,.4);
      letter-spacing: .04em;
    }

    .k-auto-submit-msg {
      margin-top: clamp(16px, 3vh, 28px);
      font-size: clamp(12px, 1.4vw, 16px);
      color: #d4a853;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      animation: k-fade-in 0.4s ease-out both;
    }
    .k-spinner {
      width: 16px; height: 16px;
      border: 2px solid rgba(212,168,83,.3);
      border-top-color: #d4a853;
      border-radius: 50%;
      animation: k-spin 0.8s linear infinite;
    }
    @keyframes k-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes k-spin {
      to { transform: rotate(360deg); }
    }

    .k-feedback-divider {
      display: flex; align-items: center; justify-content: center;
      margin-bottom: clamp(16px, 2.5vh, 24px);
    }
    .k-feedback-divider::before,
    .k-feedback-divider::after {
      content: '';
      flex: 1; height: 1px;
      background: linear-gradient(to right, transparent, rgba(184,146,74,.25), transparent);
    }
    .k-feedback-divider-diamond {
      color: rgba(184,146,74,.4); font-size: 14px;
      padding: 0 16px;
    }

    .k-feedback-prompt {
      font-family: 'Cormorant Garamond', 'Georgia', serif;
      font-size: clamp(22px, 3.2vw, 36px); font-weight: 400;
      font-style: italic; color: #d4a853;
      margin-bottom: 6px;
    }
    .k-feedback-sub {
      font-size: clamp(12px, 1.4vw, 16px);
      color: rgba(255,255,255,.38);
      margin-bottom: clamp(16px, 2.5vh, 24px);
    }

    .k-feedback-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: clamp(8px, 1.5vw, 12px);
      margin-bottom: clamp(20px, 3.5vh, 32px);
      width: 100%;
    }
    .k-chip {
      padding: clamp(10px, 1.5vw, 14px) clamp(4px, 1vw, 12px);
      border: 1.5px solid rgba(255,255,255,.15);
      border-radius: 99px;
      background: rgba(255,255,255,.05); color: rgba(255,255,255,.8);
      font-size: clamp(11px, 1.4vw, 15px); font-family: inherit;
      cursor: pointer; transition: all .2s;
      user-select: none;
      display: flex; align-items: center; justify-content: center;
      text-align: center; line-height: 1.2;
    }
    .k-chip:hover {
      border-color: rgba(212,168,83,.4);
      background: rgba(212,168,83,.1);
    }
    .k-chip.selected {
      border-color: #b8924a;
      background: rgba(184,146,74,.2);
      color: #fff;
      box-shadow: 0 4px 16px rgba(184,146,74,.2);
    }

    /* ── Gold button ─────────────────────── */
    .k-btn-gold {
      padding: clamp(14px, 2.2%, 22px) clamp(40px, 7%, 80px);
      background: linear-gradient(135deg, #c9a96e, #9a7535);
      border: none; border-radius: 8px; color: #0d0b08;
      font-size: clamp(12px, 1.4vw, 17px); font-weight: 700;
      letter-spacing: .15em; text-transform: uppercase;
      cursor: pointer; font-family: inherit;
      transition: transform .15s, box-shadow .15s;
      box-shadow: 0 6px 24px rgba(184,146,74,.35);
      min-height: 48px;
    }
    .k-btn-gold:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 32px rgba(184,146,74,.5);
    }
    .k-btn-gold:disabled { opacity: .5; cursor: not-allowed; }

    /* ── Privacy ──────────────────────────── */
    .k-privacy {
      font-size: clamp(10px, 1vw, 13px); color: rgba(255,255,255,.15);
      margin-top: clamp(20px, 3vh, 36px);
    }

    /* ── Thank you ────────────────────────── */
    .k-thanks {
      background: #024638; text-align: center;
      padding: clamp(24px, 5%, 80px);
      justify-content: center;
    }
    .k-thanks-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 50% 40%, rgba(184,146,74,.2), transparent 50%);
      pointer-events: none;
    }
    .k-thanks-icon {
      width: clamp(72px, 10vw, 110px); height: clamp(72px, 10vw, 110px);
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(201,169,110,.1), rgba(154,117,53,.05));
      border: 1px solid rgba(212,168,83,.3);
      display: flex; align-items: center; justify-content: center;
      color: #d4a853;
      margin-bottom: clamp(32px, 4.5%, 48px);
      position: relative; z-index: 1;
      box-shadow: 0 0 60px rgba(184,146,74,.15);
      animation: k-pulse 2s infinite ease-in-out;
    }
    @keyframes k-pulse {
      0%, 100% { box-shadow: 0 0 40px rgba(184,146,74,.15); transform: scale(1); }
      50% { box-shadow: 0 0 80px rgba(184,146,74,.35); transform: scale(1.02); }
    }
    .k-thanks-title {
      font-family: 'Cormorant Garamond', 'Georgia', serif;
      font-size: clamp(42px, 7.5vw, 90px); font-style: italic;
      font-weight: 300; color: #fff;
      margin-bottom: 20px; position: relative; z-index: 1;
    }
    .k-thanks-sub {
      font-size: clamp(14px, 1.8vw, 22px); color: rgba(255,255,255,.5);
      line-height: 1.6; max-width: 520px; margin-bottom: clamp(40px, 6%, 60px);
      position: relative; z-index: 1;
    }
    .k-thanks-restart {
      background: transparent; border: none;
      color: #d4a853;
      font-size: clamp(12px, 1.2vw, 15px); font-weight: 600; letter-spacing: .2em;
      text-transform: uppercase; cursor: pointer; font-family: inherit;
      position: relative; z-index: 1; margin-bottom: clamp(32px, 5%, 48px);
      transition: all .2s; min-height: 48px;
      padding: 12px 24px; border-radius: 99px;
    }
    .k-thanks-restart:hover { 
      background: rgba(212,168,83,.1); 
    }
    
    .k-thanks-timeout {
      font-size: clamp(11px, 1.2vw, 14px); letter-spacing: .12em; text-transform: uppercase;
      color: rgba(255,255,255,.3); position: relative; z-index: 1;
      display: flex; align-items: center; justify-content: center; gap: 6px;
    }
    .k-timeout-num {
      color: #d4a853; font-weight: 700; font-variant-numeric: tabular-nums;
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

    /* ── Responsive: iPad & mobile ────────── */

    /* iPad / tablet layout */
    @media (max-width: 1024px) {
      .k-main-content {
        padding-top: clamp(90px, 14vh, 140px);
        max-width: 90%;
      }
      .k-rating-pills {
        max-width: 100%;
      }
      .k-rating-pill {
        padding: clamp(20px, 3vw, 32px) clamp(10px, 1.5vw, 20px);
      }
      .k-pill-num {
        font-size: clamp(34px, 5vw, 44px);
      }
      .k-pill-label {
        font-size: clamp(10px, 1.5vw, 14px);
      }
    }

    /* Small phones */
    @media (max-width: 420px) {
      .k-main-content {
        padding-top: clamp(72px, 11vh, 100px);
        padding-left: 16px;
        padding-right: 16px;
      }
      .k-welcome-title { font-size: clamp(22px, 6.5vw, 32px); }
      .k-rating-pills { gap: 6px; }
      .k-rating-pill {
        padding: 12px 4px;
        border-radius: 8px;
      }
      .k-pill-num { font-size: clamp(20px, 6vw, 28px); }
      .k-pill-label { font-size: 7px; letter-spacing: .04em; }
      .k-feedback-chips { gap: 6px; }
      .k-chip { padding: 8px 4px; font-size: 10px; }
    }

    /* Landscape on mobile/tablet */
    @media (max-height: 500px) and (orientation: landscape) {
      .k-main-content {
        padding-top: 64px;
        padding-bottom: 20px;
      }
      .k-welcome-title { font-size: clamp(20px, 3.5vw, 32px); margin-bottom: 4px; }
      .k-welcome-sub { margin-bottom: 16px; font-size: clamp(11px, 1.4vw, 15px); }
      .k-rate-eyebrow { margin-bottom: 10px; }
      .k-rating-pill { padding: 10px 6px; }
      .k-feedback-chips { margin-bottom: 16px; }
    }
  `]
})
export class ExperienceComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly i18n = inject(I18nService);
  private readonly seo = inject(SeoService);

  // This page keeps its own copy in a local STRINGS map, but the head tags
  // follow the site-wide locale like every other page.
  private readonly seoTags = this.seo.watch(() => ({
    title: this.i18n.t('seo.experience.title'),
    description: this.i18n.t('seo.experience.description'),
    canonicalPath: '/experience',
    type: 'article' as const,
  }));

  // ── Lang ───────────────────────────────────────────────────
  readonly lang = signal<ExperienceLang>('en');
  s = (key: string): string => STRINGS[this.lang()][key] ?? key;
  toggleLang(): void {
    this.lang.update((l) => l === 'en' ? 'ar' : 'en');
  }

  nl2br(text: string): string {
    return text.replace(/\n/g, '<br>');
  }

  // ── State ──────────────────────────────────────────────────
  readonly view = signal<ExperienceView>('main');
  readonly rating = signal(0);
  readonly hoverRating = signal(0);
  readonly selectedOptions = signal<string[]>([]);
  readonly submitting = signal(false);
  readonly autoSubmitting = signal(false);
  readonly countdown = signal(5);
  readonly particles = signal<Particle[]>([]);
  readonly ringOffset = computed(() => 163.36 * (1 - this.countdown() / 5));

  // Auto-submit countdown for low ratings (<=3) once an option is chosen
  private static readonly LOW_RATING_AUTO_SUBMIT_SECONDS = 5;
  readonly lowRatingCountdown = signal(0);
  private lowRatingTimer: ReturnType<typeof setTimeout> | null = null;
  private lowRatingInterval: ReturnType<typeof setInterval> | null = null;

  readonly showFeedback = computed(() => this.rating() > 0 && this.rating() <= 3);

  readonly ratingPills = computed(() => [
    { value: 1, label: this.s('ratingVal1') },
    { value: 2, label: this.s('ratingVal2') },
    { value: 3, label: this.s('ratingVal3') },
    { value: 4, label: this.s('ratingVal4') },
    { value: 5, label: this.s('ratingVal5') },
  ]);

  readonly options = computed(() => STRINGS[this.lang()]['feedbackOptions'] as string[]);

  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  private readonly apiBase = (() => {
    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    return isLocal
      ? `${window.location.protocol}//${window.location.hostname}:3000/api`
      : '/api';
  })();

  ngOnInit(): void {
    this.startActivity();
  }

  ngOnDestroy(): void { this.clearTimers(); this.clearLowRatingCountdown(); }

  // ── Options ────────────────────────────────────────────────
  toggleOption(opt: string): void {
    this.resetActivity();
    this.selectedOptions.update(opts =>
      opts.includes(opt) ? opts.filter(o => o !== opt) : [...opts, opt]
    );

    // Any chip change on a low rating restarts the countdown, giving the user
    // a fresh window after each edit.
    if (this.showFeedback()) {
      this.startLowRatingCountdown();
    }
  }

  // ── Rating selection ───────────────────────────────────────
  selectRating(n: number): void {
    this.rating.set(n);
    this.resetActivity();
    this.clearLowRatingCountdown();

    // For high ratings (4–5), auto-submit after a brief visual confirmation
    if (n >= 4) {
      this.autoSubmitting.set(true);
      setTimeout(() => this.submit(), 1500);
    } else if (n > 0) {
      // For low ratings (1–3), arm the auto-submit countdown immediately —
      // selecting a feedback chip restarts it (see toggleOption), or the user
      // can submit manually before it fires.
      this.startLowRatingCountdown();
    }
  }

  // ── Low-rating auto-submit countdown ────────────────────────
  private startLowRatingCountdown(): void {
    this.clearLowRatingCountdown();
    this.lowRatingCountdown.set(ExperienceComponent.LOW_RATING_AUTO_SUBMIT_SECONDS);
    this.lowRatingInterval = setInterval(() => {
      const v = this.lowRatingCountdown() - 1;
      this.lowRatingCountdown.set(v);
      if (v <= 0) {
        this.clearLowRatingCountdown();
        this.submit();
      }
    }, 1000);
  }

  private clearLowRatingCountdown(): void {
    if (this.lowRatingTimer) { clearTimeout(this.lowRatingTimer); this.lowRatingTimer = null; }
    if (this.lowRatingInterval) { clearInterval(this.lowRatingInterval); this.lowRatingInterval = null; }
    this.lowRatingCountdown.set(0);
  }

  // ── Submit ─────────────────────────────────────────────────
  async submit(): Promise<void> {
    if (this.submitting()) return;
    this.clearLowRatingCountdown();

    this.submitting.set(true);
    try {
      const bodyText = this.selectedOptions().join(', ') || null;

      await firstValueFrom(
        this.http.post(`${this.apiBase}/reviews`, {
          rating: this.rating() || null,
          body: bodyText,
          authorName: null,
          authorPhone: null,
          authorEmail: null,
          source: 'experience',
        }),
      );
    } catch { /* silent — still show thanks */ } finally {
      this.submitting.set(false);
      this.view.set('thanks');
      this.startCountdown();
      this.spawnParticles();
    }
  }

  private spawnParticles(): void {
    const count = 28;
    const list: Particle[] = Array.from({ length: count }, (_, i) => {
      const svg = PARTICLE_ICONS[i % PARTICLE_ICONS.length];
      const x = Math.round(Math.random() * 94);
      const dur = (3.5 + Math.random() * 5).toFixed(1);
      const delay = (Math.random() * 8).toFixed(1);
      const sw = Math.round(12 + Math.random() * 28);
      const sz = Math.round(13 + Math.random() * 20);
      return {
        html: this.sanitizer.bypassSecurityTrustHtml(svg),
        style: `left:${x}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:-${delay}s;--sw:${sw}px`,
      };
    });
    this.particles.set(list);
  }

  // ── Restart ────────────────────────────────────────────────
  restart(): void {
    this.clearTimers();
    this.clearLowRatingCountdown();
    this.rating.set(0);
    this.hoverRating.set(0);
    this.selectedOptions.set([]);
    this.autoSubmitting.set(false);
    this.countdown.set(5);
    this.particles.set([]);
    this.view.set('main');
    this.startActivity();
  }

  // ── Activity / auto-reset ──────────────────────────────────
  @HostListener('document:touchstart')
  @HostListener('document:click')
  resetActivity(): void {
    if (this.view() === 'main') {
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
