# Challenge, event rules and resources

Official 2026 challenge selected for this project, the event rules that govern the
submission, and the shared resources the team used.

- **Event:** NASA International Space Apps Challenge, Málaga 2026 (14-15 November 2026)
- **Challenge:** Lunar Landing Site Navigator
- **Official page:** <https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/>
- **Challenge number:** 10 (CLPS)
- **Partner agency:** CSA (Canadian Space Agency)

## 1. Official challenge statement (summary)

Missions to the Moon's south pole face extreme lighting and communication
constraints. Mission planners need an intuitive tool to **compare landing sites and
dates quickly**, visualising **Sun and Earth positions relative to the horizon** to
assess **power generation potential** and **direct-to-Earth communication windows**.

The challenge describes the current gap: tools such as NASA QuickMap, Moon Trek and
JPL Horizons contain the right data but are built for detailed analysis and are hard
to use for rapid scenario comparison. An accessible interface that turns ephemeris
and topographic data into comparable visualisations would help mission planners,
educators and the public.

### Suggested objectives (from the challenge)

- Interactive site selection and comparison, with a curated list of notable landing
  sites and the ability to input custom lunar coordinates.
- Side-by-side or sequential comparison of multiple sites and dates.
- Sun and Earth position visualisation relative to the horizon, including time
  remaining before sunset or Earthset.
- Power and communication assessment: solar elevation, sunlight duration,
  Earth-visibility windows.
- 2D maps, 3D surface visualisations and timeline/animation views.
- Accessibility for mission planners as well as educators and the public.

### Suggested NASA data (from the challenge)

| Resource | Link | Use in this project |
| --- | --- | --- |
| QuickMap (LROC/ASU) | <https://quickmap.lroc.asu.edu/> | Cross-check landing-site locations and terrain; deep links in the JSON brief |
| Moon Trek | <https://trek.nasa.gov/moon/> | Imagery, slope, illumination and temperature layers (21 verified WMTS layers) |
| JPL Horizons | <https://ssd.jpl.nasa.gov/horizons/> | Topocentric Sun and Earth azimuth/elevation (pre-computed datasets) |
| LOLA (via PDS Geosciences) | <https://pds-geosciences.wustl.edu/> | Real south-pole digital elevation models for terrain and horizon calculations |
| CSA Moon Exploration | <https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/> | Reference for lunar exploration context and the CSA "Moon Explorer" site list |

### How this project answers the challenge

| Challenge objective | Implementation |
| --- | --- |
| Site selection and comparison | 10 curated south-pole sites (nine Artemis III candidate regions plus Shackleton rim), custom coordinates, terrain-pointer selection, comparator panel |
| Date and time flexibility | Mission timeline with playback, date/time controls and ephemeris range 2026-11-01 to 2026-12-31 |
| Sun/Earth versus horizon | Ray-traced terrain horizon with lunar curvature, Sun and Earth direction vectors, 3D and 2D views |
| Time to sunset or Earthset | Countdown panel computed from the pre-computed Horizons datasets |
| Power and communications | Solar power estimate and Earth-visibility/relay communication windows |
| 2D and 3D temporal views | Three.js surface visualisation, Canvas 2D fallback, timeline sparkline |
| Accessibility | English/Spanish interface, keyboard-friendly controls, WebGL fallback |
| Rapid comparison | Autopilot ranking over the mission window with human-readable reasons |

### NASA data used (summary)

- **JPL Horizons (DE441)** - topocentric Sun and Earth azimuth/elevation,
  30-minute steps, 10 sites, 2026-11-01 to 2026-12-31 (pre-computed; no runtime API
  dependency).
- **LOLA polar DEMs (PDS Geosciences)** - `LDEM_875S_20M` (74 m/px web grid) and
  `LDEM_80S_80M` (594 m/px wide area), polar stereographic, metres relative to
  R = 1,737,400 m.
- **Moon Trek WMTS** - 21 verified south-pole layers (LOLA relief and slope, LROC
  imagery, illumination percentage, Earth visibility, permanently shadowed regions,
  Diviner temperature).
- **QuickMap** - deep links for cross-checking site locations and terrain.

Endpoints, CORS behaviour, provenance, licensing and limitations are documented in
[data.md](data.md).

## 2. Event facts

| Item | Detail |
| --- | --- |
| Event | NASA International Space Apps Challenge, Málaga 2026 |
| Dates | 14-15 November 2026 |
| Venue | 42 Málaga Fundación Telefónica, Av. Sor Teresa Prat 15, Edificio E3, Complejo Tabacalera, 29003 Málaga |
| Local welcome | Friday 13 November, 17:30 |
| Development starts | Saturday 14 November, 09:00 local time |
| Official submission deadline | Sunday 15 November 2026, before 23:59 local time |
| Local lead | Celeste Sánchez, <nasa.spaceapps.malaga@gmail.com> |

## 3. Team and participation rules

- Teams of **1 to 6 people**.
- Every member must be registered, accepted for the **same Málaga Local Event** and
  joined to the team on the platform. Being physically at the venue does not replace
  registration.
- A **Team Owner** manages team creation and configuration and coordinates Project
  editing. The Team Owner does not have to lead all the work.
- Participants under 18 require registration by a parent or legal guardian and
  accompaniment during the event.
- **Before Saturday 09:00** the rules allow meeting people, forming teams, reading
  the challenges and getting familiar with resources and tools; they do **not** allow
  advancing the development of the solution. Pre-existing materials or work must be
  declared.

## 4. Deliverables: the Project page

The Project page is the record the jury reviews; the demo is only one part of the
submission.

| Element | What it must contain |
| --- | --- |
| Name and summary | Project name and a 50-200 word summary: what was built, how it answers the challenge and why it matters |
| Project Demo | A single public link: presentation of at most **7 slides including the cover**, or a video of at most **30 seconds** |
| Final Project | Public link to the project, repository, site or material that allows the solution to be understood and reviewed |
| Detailed description | What it does, how it works, benefits, tools, method, real development status and limitations |
| NASA Data | NASA resources used, links and explanation of their contribution. For Global Awards, at least one NASA resource from the challenge |
| Other data and references | Partner-agency sources and references for data, code, images, text and tools, even when open |
| AI / SI use | Tools used and how they were incorporated; required labels and declarations for generated content |
| Review and acceptance | All required fields and checkboxes, correct members, accessible links, submission confirmed within the deadline |

**Language and access:** page, slides and written materials in **English**. A video
may be narrated in another language only with **English subtitles**. Demo and Final
Project links must open **without password, permission, registration or access
request**.

## 5. Project Demo rules

### Option A: slides (maximum 7, cover included)

1. Team and project name, challenge chosen and one sentence explaining the solution.
   Do not identify minors.
2. Concrete problem and the people or context affected.
3. Solution and user journey, with a simple diagram.
4. NASA data or resource: origin and real role in the project.
5. Demonstration of the prototype, result or evidence of the concept.
6. What has been verified, what works and its limitations.
7. Expected impact, next step and essential references.

The demo must be understandable without a live explanation, legible, honest (built
versus simulated versus planned) and accessible.

### Option B: video (maximum 30 seconds)

1. **Problem** - concrete problem and who or what it affects.
2. **Solution** - what was built and the main idea.
3. **Demo** - a visible working part, a result or evidence of the concept.
4. **NASA** - which NASA resource is used and what value it adds.

Technical checks: duration at most 30 s, audio clarity, English subtitles if
narration is not in English, public access without login, and no identifiable names,
voices or images of minors.

The project's demo assets are described in [demo.md](demo.md).

## 6. Submission process

- Drafts saved with **Save Progress**, sharing links or uploading files to Drive are
  useful steps, but the project is only submitted when **Submit for Judging** is
  completed and the confirmation is shown.
- **Deadline:** Sunday 15 November 2026 before 23:59 in the local event time zone. No
  later edits or exceptions are accepted for global evaluation.
- If any content changes before the deadline: save and **submit again**, then verify
  that the final version was submitted.
- If the platform fails: capture the exact message, time, team URL and steps that
  triggered the error; hide personal data and do not share passwords. Support does
  not guarantee a deadline extension.
- The local Drive space provided by the organisation does **not** replace the
  Project page plus Submit for Judging.
- Submitting within the deadline gives the participation certificate.

## 7. Responsible use

- **AI is allowed.** The team remains responsible for decisions, verification and
  authorship of the submitted content (see [ai-usage.md](ai-usage.md)).
- Declare the AI tools used and how they were incorporated.
- Add visible marking to generated images and videos; recognise generated code and
  data in the description and metadata.
- Do not use NASA brand elements (logos, flags, mission identifiers) in generated
  content.
- Do not upload credentials, unnecessary personal data or confidential material.
- Cite external materials and check their rights and licences; do not assume reuse
  rights just because material is accessible online.
- **Minors' privacy:** no identifiable names, voices or images of people under 18 in
  the materials sent to NASA.
- Submitting implies publishing the solution under the participation terms.

## 8. Judging and local pitch

The five reference criteria (Impact, Creativity, Validity, Relevance, Presentation)
and the Málaga judges' professional lenses are mapped to this project in
[commercial.md](commercial.md).

- The **local pitch is not the Project Demo** and does not replace Submit for
  Judging.
- Expected on Sunday 15 November: technical tests 16:30-17:15 and pitches
  17:30-19:00.
- The oral presentation may be in Spanish or English; visual material and slides must
  be in **English**.
- Published references differ on pitch duration, slide limit and Q&A (2-2:30 min or
  2-3 min, with 2-3 questions). Confirm the final rule with the organisation before
  the technical test.
- Recommended story: problem, solution, NASA resource, evidence, limits, next step.

## 9. Weekend schedule (reference)

| Moment | What happens |
| --- | --- |
| Friday 13, 17:30 | Local opening: welcome, orientation, networking, team formation |
| Saturday 14, 09:00 | Official development start; Project opens |
| Saturday, 11:00-13:30 | Mentoring: refine problem, scope, data and first attempt |
| Saturday, 14:30-17:30 | Work and clinics: resolve blockers, review decisions, prepare a demonstrable part |
| Saturday, 17:30-18:00 | Review: clarify what must be ready on Sunday |
| Sunday, 09:00-16:00 | Final work, documentation, demo and rehearsals with mentoring support |
| Sunday, 16:30-17:15 | Technical pitch tests |
| Sunday, 17:30-19:00 | Team pitches |
| Sunday, 19:00-20:00 | Local deliberation, awards and closing |
| Sunday, before 23:59 | Official NASA close: final version submitted with Submit for Judging |

Málaga may set an earlier local cut-off for pitches or local awards; that cut-off
does not replace the official NASA deadline.

## 10. Last-30-minutes checklist

- [ ] Correct team: every member registered and joined.
- [ ] All required fields and checkboxes complete.
- [ ] Summary of 50-200 words, clear and consistent with the project.
- [ ] NASA Data explained: resource, link and real function.
- [ ] Other references, rights and licences reviewed.
- [ ] AI/SI declared; generated material marked where required.
- [ ] Project Demo within limits: at most 7 slides or at most 30 seconds.
- [ ] Page, slides and written materials in English; English subtitles if the video
      is in another language.
- [ ] Demo and Final Project public; tested without logging in.
- [ ] Privacy: no identifiable names, voices or images of minors.
- [ ] **Submit for Judging** pressed and confirmation visible.
- [ ] If anything changed afterwards: Save Progress, submit again, confirm again.

## 11. Global phase (reference)

- A local award does not guarantee a Global Nominee spot; a valid official
  submission, eligibility and selection within Málaga's quota are required.
- Application review: 16-22 November 2026; the Local Lead registers global candidates
  before 22 November 2026 at 23:59 local.
- Global candidates: 3 December 2026; finalists and mentions: 17 December 2026;
  global winners: 27 January 2027.
- These dates are references and may be adjusted by NASA; check official
  announcements.

## 12. Shared resources

### Organisation Drive folder

The Málaga 2026 organisation shares the guide and event resources in this public
folder (no login required):
<https://drive.google.com/drive/folders/1-g29mDdohRr1xIUAhLrMhTArDWyx2A2m>

| Folder | Contents |
| --- | --- |
| [CHALLENGES](https://drive.google.com/drive/folders/19pGyM8LWowZgNM-fR0XSWI4J9wlu587F) | 2026 challenge wallpapers: three PNG images and a PDF |
| [HELP](https://drive.google.com/drive/folders/19WYR3fpP3-JElKsOhuS2RKpK5OusJmGL) | Participant guide, judges guide and brainstorming poster |
| [TOOLKIT](https://drive.google.com/drive/folders/1YXXdnUVcBSG7uExRZ9FcMTlKDkQUaCrl) | Social media copy for participants |
| [UX](https://drive.google.com/drive/folders/1ZIW-RWl96_nPDtQP7YLrKWbm-lK6H_RQ) | UX support guide for Málaga |

Key files:

| File | Folder | Description |
| --- | --- | --- |
| [Guía del participante, Space Apps 2026](https://drive.google.com/file/d/1mUJiHmPL3vA4JRsKGmPqqGyU2SpfMFMQ/view) | HELP | Official participant guide (Spanish); this document summarises the rules in English |
| [Jueces, Space Apps Málaga 2026](https://drive.google.com/file/d/1D5uCwViVlEn45-rC-wpZguMQMpY5esAA/view) | HELP | Judges guide: local pitch and judging references (Spanish) |
| [Póster Brain Storming NASA](https://drive.google.com/file/d/1Gmql5rRRvhrQcexXAEzdLfwzyCtIgR3N/view) | HELP | A0 brainstorming poster |
| [Guía de apoyo UX](https://drive.google.com/file/d/1Tjk9dCWMy2Xycav5NHpym6sX8z5opWh8/view) | UX | UX support guide (Spanish) |
| [Wallpaper - Retos](https://drive.google.com/file/d/1ccp2DN_r2AusKiFepGnDH-HDgVUd8mAl/view) | CHALLENGES | Challenge-themed wallpaper (PDF) |

The official participant guide and the organisation's announcements take precedence
over this English summary. The Drive files are linked, not copied into the
repository.

### Official links

| Resource | Link |
| --- | --- |
| Málaga 2026 Local Event | <https://www.spaceappschallenge.org/2026/local-events/malaga/> |
| NASA Space Apps Challenge 2026 | <https://www.spaceappschallenge.org/2026/> |
| Challenges 2026 | <https://www.spaceappschallenge.org/2026/challenges/> |
| Participant FAQs | <https://www.spaceappschallenge.org/resources/participant-faqs/> |
| Resources | <https://www.spaceappschallenge.org/resources/> |
| Legal and participation terms | <https://www.spaceappschallenge.org/legal/> |
| Space Apps community | <https://github.com/nasa/spaceapps> |
| 42 Málaga | <https://www.42malaga.com/> |

### NASA data portals

| Resource | Use |
| --- | --- |
| [NASA Science Data Portal](https://science.data.nasa.gov/) | Discovery of scientific data and repositories |
| [NASA Open Data](https://data.nasa.gov/) | Data catalogue and dataset links |
| [NASA APIs](https://api.nasa.gov/) | APIs and access conditions; optional API key in `.env` (see [security.md](security.md)) |
| [Earthdata Search](https://search.earthdata.nasa.gov/) | Earth observation data; some access requires Earthdata Login |

### Help channels

| Channel | Contact |
| --- | --- |
| Málaga organisation | <nasa.spaceapps.malaga@gmail.com> |
| Platform failures | <web@spaceappschallenge.org> |
| Community | <https://github.com/nasa/spaceapps> |
