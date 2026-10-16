# Design decisions

The decisions behind 3D Wind Rose, and my reasons for them.
[`ARCHITECTURE.md`](ARCHITECTURE.md) describes how the code is organised, and
the [method notes](docs/method-notes.html) describe what the tool computes,
what it does not, and what a figure from it can support. This file records
why the tool is the way it is. Written in October 2026, at version 1.1.0.

— Karam Al-Obaidi

## Why it exists

My students needed to read the wind for the sites they were designing on.
What they had kept the wind apart from the site:

- **Online climate tools** draw a flat 2D chart, cut off from the site and
  the building.
- **Static images** of wind roses, copied from reports or websites, were
  often for a station far from the site, with no way to change the month.

## Why it runs in the browser

- **Nothing to install.** No licence and no admin rights, on lab PCs or on
  students' own laptops.
- **Any device, and embeddable.** It runs on any machine and sits inside my
  website.

## Method

### A 3D rose on a live map, beside the building

- **Read against the site.** Wind direction is read against the real site and
  its orientation, not on a separate chart.
- **At building scale.** Sized to the building's footprint, the rose can be
  read against the building the student is designing.
- **Engaging.** A 3D rose on the site holds students' attention better than a
  flat chart.
- **A step to flow tools.** It shows what a rose cannot tell you, such as
  shelter and wake, which leads on to Urban Wind Lab.

### The station's wind as recorded, with no correction

The rose uses the EPW file's 10 m open-country wind with no height, terrain or
roughness correction.

- **Deliberate scope.** The tool teaches what a wind rose is and how one is
  built from recorded data; correcting it is a separate lesson.
- **Honest to the data.** Showing the station's record unaltered keeps every
  number traceable to the file.
- **A browser limit.** A credible correction needs terrain and roughness data
  the browser does not have.
- **Planned.** A height and terrain correction is something I intend to add.

### Three UK presets

London, Sheffield (Doncaster Airport) and Edinburgh (Turnhouse Airport) are
built in.

- **Where I teach.** Sheffield is where my students are, and London and
  Edinburgh are the UK sites they compare it with.
- **An instant start.** A rose appears at once, with no EPW to find or
  download.
- **For the exercises.** All three exercises run on the presets alone.

### Calm hours in the total

Each cell's percentage is divided by all hours, calm included, so the petals
sum to 100 minus the calm percentage. This was not a deliberate choice; it is
how the code came out. The method notes explain it, so a reader quoting a
petal quotes the calm percentage with it.

### The rose's size follows the building, not the data

- **It reads at building scale.** The rose stays legible around whatever
  building is loaded, from a house to a block.
- **Context, not data.** Only the rose's proportions carry information, so its
  size can serve the drawing.

## Teaching

I use the tool in undergraduate and postgraduate teaching.

**The exercises are mine**: the three in the method notes.

1. The prevailing direction moves with the seasons.
2. A rose cannot tell you where a building is sheltered.
3. How often is not how hard.

Three things in the app came from how students used it:

- **The Android fix (1.0.1).** The rose failing on some Android phones came to
  light on students' own devices.
- **The screenshot export.** Screenshots carry the legend and its figures for
  students' boards and submissions.
- **The wind-data/site warning.** The 50 km warning came from students reading
  a preset's rose for a site far from its station.

## What it leaves out

- **Flow and shelter.** No downwash, channelling or wake: that is Urban Wind
  Lab's job.
- **Comfort criteria.** No Lawson or other comfort classes: a rose alone
  cannot support a comfort claim.
- **Gusts and exceedance.** Mean hourly frequencies only: no gust speeds or
  exceedance probabilities.

## How a release is checked

Before I teach with a release:

- **I use the live site myself**, as a student would.
- **I work through the exercises** and check that they still show what they
  should.
- **I try it on several devices**, phones and laptops, since the 1.0.1 bug
  only appeared on some of them.

## Licensing and archiving

The code is MIT and the teaching material is CC BY 4.0:

- **The code is free to reuse.** Anyone can adapt or embed it.
- **The material is reusable with credit.** Other educators can use the notes
  and exercises in their own courses, crediting the source.
- **The cube mark is reserved from both**, so a modified copy cannot pass
  itself off as mine.
- **Open licensing is expected** of this kind of work by my university or
  funders.

Every version is archived on Zenodo with its own DOI:

- **Reproducible figures.** A reported number can be traced to the exact build
  that produced it.
- **A citable research output.** The software counts as an output in its own
  right.
- **A permanent archive.** Each version survives even if my website changes.
- **Credit when reused.** Anyone who uses it has a proper way to cite it.

## How this was developed

I designed the application. I defined the problem and the scope: what the tool
is for, who it is for and what it leaves out. I chose the methods and the
sources it relies on, and set the exercises. I tested it in use, found and
reported the bugs, judged whether each fix worked, and decided what was
released and when.

The code was written with an AI coding assistant, working to my specification
and direction. It wrote most of the code, drafted the documentation, which I
reviewed, diagnosed bugs and proposed fixes, which I then tested, and wrote and
ran the release checks. I retain full intellectual responsibility for the
design, the methods and the results, including any errors.

## Next

- **Height and terrain**: correct the station's 10 m open-country wind to the
  site's height and terrain.
- **Two roses side by side**: compare two months or two locations directly.
- **The map key out of the page**: serve the map through a proxy, so no
  MapTiler key is in the page.
