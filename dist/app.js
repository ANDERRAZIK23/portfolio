'use strict';

const projects = {
  bcp: {
    title: 'BP Annexe',
    category: 'BANQUE CENTRALE POPULAIRE · PFE · FÉVR. — JUIL. 2026',
    description: 'Une plateforme qui centralise et automatise le cycle de production des annexes réglementaires bancaires, en reliant les données métier, les traitements et le suivi opérationnel.',
    features: [
      'Gestion des partenaires et des produits, import des fichiers métier, contrôles, génération des annexes et compléments manuels.',
      'Microservices Spring Boot et API REST sécurisées pour suivre les productions, les retours partenaires, les contrats et les notifications. Communication avec OpenFeign et Kafka.',
      'Tableau de bord développé en React et TypeScript, avec sécurisation des accès par Keycloak et LDAP.',
      'Intégration de Parakletos, un assistant métier RAG qui exploite la documentation et les données opérationnelles.'
    ],
    tags: ['Spring Boot', 'React', 'TypeScript', 'OpenFeign', 'Kafka', 'Keycloak', 'LDAP', 'RAG'],
    source: null
  },
  elearn: {
    title: 'E-Learn',
    category: 'PROJET ACADÉMIQUE · NOVEMBRE 2025',
    description: 'Une plateforme d’apprentissage en ligne conçue autour de sept services, avec des responsabilités distinctes pour les utilisateurs, les cours et le parcours de formation.',
    features: [
      'Architecture composée des services Discovery, Gateway, User, Course, Enrollment, Certificate et Content.',
      'Découverte des services avec Eureka, communication avec OpenFeign et gestion de la résilience avec Resilience4j.',
      'API REST sécurisées par JWT.',
      'Génération de certificats PDF avec iText 7 et de codes QR avec ZXing.'
    ],
    tags: ['Java 17', 'Spring Boot 3.2', 'Spring Cloud', 'Eureka', 'OpenFeign', 'Resilience4j', 'JWT', 'iText 7', 'ZXing'],
    source: 'https://github.com/anderrazik23/e-learn'
  },
  carelink: {
    title: 'CareLink',
    category: 'PROJET ACADÉMIQUE · OCT. — DÉC. 2025',
    description: 'Une application full-stack pour organiser le fonctionnement d’un cabinet médical, du suivi des patients à la gestion des rendez-vous et des ordonnances.',
    features: [
      'Gestion des patients, des médecins, des rendez-vous et des ordonnances.',
      'Back-end Spring Boot et API REST sécurisées par JWT.',
      'Interface Angular et base de données MySQL.',
      'Fonctionnalités d’aide à la décision pour le suivi médical.'
    ],
    tags: ['Spring Boot', 'Angular', 'MySQL', 'API REST', 'JWT'],
    source: 'https://github.com/anderrazik23/CareLink'
  },
  nutrition: {
    title: 'Control Your Life',
    category: 'PROJET ACADÉMIQUE · INTELLIGENCE ARTIFICIELLE · 2026',
    description: 'Un assistant d’analyse nutritionnelle qui associe un réseau de neurones convolutif (CNN) et la génération augmentée par recherche documentaire (RAG).',
    features: [
      'Identification des repas à l’aide d’un CNN.',
      'Estimation des calories et récupération des informations nutritionnelles.',
      'Utilisation du RAG pour enrichir les réponses avec des informations issues de la recherche documentaire.',
      'Évaluation de la qualité nutritionnelle des repas.'
    ],
    tags: ['CNN', 'RAG', 'Vision par ordinateur', 'IA nutritionnelle'],
    source: null
  }
};

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');

function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Ouvrir le menu');
  navigation.classList.remove('is-open');
}

menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  menuButton.setAttribute('aria-label', expanded ? 'Ouvrir le menu' : 'Fermer le menu');
  navigation.classList.toggle('is-open', !expanded);
});

navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menuButton.focus();
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.header-inner')) closeMenu();
});
window.matchMedia('(min-width: 561px)').addEventListener('change', event => {
  if (event.matches) closeMenu();
});

const filters = document.querySelectorAll('[data-filter]');
const cards = document.querySelectorAll('[data-categories]');
const filterStatus = document.querySelector('#filter-status');

filters.forEach(button => {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    filters.forEach(item => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    let visibleCount = 0;
    cards.forEach(card => {
      const visible = filter === 'all' || card.dataset.categories.split(' ').includes(filter);
      card.hidden = !visible;
      if (visible) {
        visibleCount += 1;
        card.classList.remove('reveal-pending');
        card.classList.add('is-revealed');
      }
    });
    filterStatus.textContent = `${visibleCount} projet${visibleCount > 1 ? 's' : ''} affiché${visibleCount > 1 ? 's' : ''}`;
  });
});

const dialog = document.querySelector('#project-dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogCategory = document.querySelector('#dialog-category');
const dialogDescription = document.querySelector('#dialog-description');
const dialogFeatures = document.querySelector('#dialog-features');
const dialogTags = document.querySelector('#dialog-tags');
const dialogSource = document.querySelector('#dialog-source');
const dialogNote = document.querySelector('#dialog-private');
let dialogTrigger = null;

document.querySelectorAll('[data-project]').forEach(button => {
  button.addEventListener('click', () => {
    const project = projects[button.dataset.project];
    dialogTrigger = button;
    dialogTitle.textContent = project.title;
    dialogCategory.textContent = project.category;
    dialogDescription.textContent = project.description;
    dialogFeatures.replaceChildren(...project.features.map(feature => {
      const item = document.createElement('li');
      item.textContent = feature;
      return item;
    }));
    dialogTags.replaceChildren(...project.tags.map(tag => {
      const item = document.createElement('span');
      item.textContent = tag;
      return item;
    }));
    dialogSource.hidden = !project.source;
    dialogNote.hidden = Boolean(project.source);
    if (project.source) {
      dialogSource.href = project.source;
    } else {
      dialogSource.removeAttribute('href');
      dialogNote.textContent = button.dataset.project === 'bcp'
        ? 'Projet réalisé à la Banque Centrale Populaire. Le code source n’est pas présenté dans ce portfolio.'
        : 'Projet académique. Le code source n’est pas présenté dans ce portfolio.';
    }
    dialog.showModal();
    dialog.scrollTop = 0;
    document.body.classList.add('dialog-open');
  });
});

document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (
    event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom
  )) dialog.close();
});
dialog.addEventListener('close', () => {
  document.body.classList.remove('dialog-open');
  if (dialogTrigger) dialogTrigger.focus();
});

document.querySelector('#year').textContent = String(new Date().getFullYear());

// Motion is optional, and system accessibility preferences take priority.
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionToggle = document.querySelector('.motion-toggle');
const resetPointerEffects = new Set();
let animationsPaused = false;
let stageTransition = null;

function motionIsReduced() {
  return animationsPaused || motionPreference.matches;
}

function updateMotion() {
  const reduced = motionIsReduced();
  if (reduced) {
    resetPointerEffects.forEach(reset => reset());
    stageTransition?.cancel();
  }
  document.body.dataset.motion = reduced ? 'reduced' : 'full';
  document.documentElement.dataset.motion = document.body.dataset.motion;
  motionToggle.setAttribute('aria-pressed', String(reduced));
  motionToggle.disabled = motionPreference.matches;
  motionToggle.querySelector('.motion-label').textContent = motionPreference.matches
    ? 'Animations réduites'
    : animationsPaused ? 'Reprendre les animations' : 'Pause animations';
  motionToggle.querySelector('.motion-indicator').textContent = reduced ? '▷' : 'Ⅱ';
}

motionToggle.addEventListener('click', () => {
  animationsPaused = !animationsPaused;
  updateMotion();
});
motionPreference.addEventListener('change', updateMotion);
updateMotion();

const stageModes = {
  backend: {
    domain: 'ARCHITECTURES DISTRIBUÉES',
    title: 'Des services.', emphasis: 'Une vision.',
    nodes: [['API', 'Spring Boot'], ['ÉVÉNEMENTS', 'Kafka'], ['SÉCURITÉ', 'Keycloak']],
    caption: 'Des API sécurisées. Des services qui communiquent.',
    counter: '01 — 03'
  },
  fullstack: {
    domain: 'DE LA DONNÉE À L’INTERFACE',
    title: 'Une interface.', emphasis: 'Tout un système.',
    nodes: [['INTERFACE', 'React'], ['BACK-END', 'Spring Boot'], ['DONNÉES', 'PostgreSQL']],
    caption: 'Relier le besoin métier à une expérience web utile.',
    counter: '02 — 03'
  },
  ai: {
    domain: 'INTELLIGENCE ARTIFICIELLE',
    title: 'Des données.', emphasis: 'Du sens.',
    nodes: [['VISION', 'CNN'], ['RECHERCHE', 'RAG'], ['LANGAGE', 'LLM']],
    caption: 'Comprendre une image. Retrouver une information. Répondre.',
    counter: '03 — 03'
  }
};
const architecture = document.querySelector('.architecture');
const stageOptions = document.querySelectorAll('.stage-option');
const stageNodeIds = ['one', 'two', 'three'];

stageOptions.forEach(button => {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-pressed') === 'true') return;
    const mode = stageModes[button.dataset.mode];
    architecture.dataset.mode = button.dataset.mode;
    stageOptions.forEach(option => {
      const active = option === button;
      option.setAttribute('aria-pressed', String(active));
      option.classList.toggle('is-active', active);
    });
    document.querySelector('#stage-domain').textContent = mode.domain;
    document.querySelector('#stage-title').textContent = mode.title;
    document.querySelector('#stage-emphasis').textContent = mode.emphasis;
    document.querySelector('#stage-caption').textContent = mode.caption;
    document.querySelector('.stage-counter').textContent = mode.counter;
    stageNodeIds.forEach((id, index) => {
      document.querySelector(`#stage-node-${id}-label`).textContent = mode.nodes[index][0];
      document.querySelector(`#stage-node-${id}`).textContent = mode.nodes[index][1];
    });
    stageTransition?.cancel();
    if (!motionIsReduced()) {
      stageTransition = architecture.querySelector('.core-name').animate(
        [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }],
        { duration: 300, easing: 'ease-out' }
      );
    }
  });
});

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.remove('reveal-pending');
    entry.target.classList.add('is-revealed');
    revealObserver.unobserve(entry.target);
  });
}, { threshold: 0.08 });

document.querySelectorAll('.section-heading, .project-card, .expertise-item, .journey-intro, .timeline-item, .education-grid, .credentials, .contact-top, .contact h2, .contact-bottom').forEach(element => {
  element.classList.add('reveal-pending');
  revealObserver.observe(element);
});

// Keyboard navigation must never land inside an invisible reveal.
document.addEventListener('focusin', event => {
  const pending = event.target.closest('.reveal-pending');
  if (!pending) return;
  pending.classList.remove('reveal-pending');
  pending.classList.add('is-revealed');
  revealObserver.unobserve(pending);
});

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
document.querySelectorAll('.project-card, [data-tilt]').forEach(element => {
  let pointerFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  const tiltRange = element.hasAttribute('data-tilt') ? 12 : 5;

  function resetPointer() {
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    ['--tilt-x', '--tilt-y', '--pointer-x', '--pointer-y'].forEach(property => {
      element.style.removeProperty(property);
    });
  }

  resetPointerEffects.add(resetPointer);
  element.addEventListener('pointermove', event => {
    if (motionIsReduced() || !finePointer.matches || event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (motionIsReduced() || !finePointer.matches) return;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = Math.max(0, Math.min(1, (pointerX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (pointerY - bounds.top) / bounds.height));
      element.style.setProperty('--tilt-x', `${(0.5 - y) * tiltRange}deg`);
      element.style.setProperty('--tilt-y', `${(x - 0.5) * tiltRange}deg`);
      element.style.setProperty('--pointer-x', `${x * 100}%`);
      element.style.setProperty('--pointer-y', `${y * 100}%`);
    });
  });
  element.addEventListener('pointerleave', resetPointer);
  element.addEventListener('pointercancel', resetPointer);
});

finePointer.addEventListener('change', () => resetPointerEffects.forEach(reset => reset()));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetPointerEffects.forEach(reset => reset());
});

const siteHeader = document.querySelector('.site-header');
const navSections = [...navigation.querySelectorAll('a')].map(link => ({
  link, section: document.querySelector(link.getAttribute('href'))
}));
let scrollFrame = 0;

function updateScrollState() {
  const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollableHeight > 0 ? Math.max(0, Math.min(1, window.scrollY / scrollableHeight)) : 0;
  document.documentElement.style.setProperty('--reading-progress', String(progress));
  siteHeader.classList.toggle('is-scrolled', window.scrollY > 20);
  const active = navSections.filter(({ section }) => section.getBoundingClientRect().top <= window.innerHeight * 0.4).at(-1);
  navSections.forEach(({ link }) => {
    if (active?.link === link) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function scheduleScrollUpdate() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateScrollState();
  });
}

window.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
window.addEventListener('resize', scheduleScrollUpdate);
updateScrollState();
