# Source assessment

Observed October 16, 2026 in America/Chicago; raw capture timestamps use UTC. This is onboarding triage, not a compatibility guarantee. Platform names are HTML hints, not verified API contracts. All recurring collection remains disabled.

82 primary URLs in 19 groups, covering 60 normalized hostnames; 15 additional citation-only leads. 73 primary URLs returned unflagged HTTP 200 responses. That is transport evidence, not successful event extraction.

## Primary URL list

### General event discovery

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-001 [https://www.eventbrite.com/](https://www.eventbrite.com/) | HTTP 200; Eventbrite city discovery | **discovery hub**: Inspect city-result pages; verify available official API access before promising national enumeration. | 6h, disabled |
| url-002 [https://allevents.in/](https://allevents.in/) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-003 [https://events.com/](https://events.com/) | HTTP 200; wordpress | **marketing / discovery hub**: Locate an actual public event feed or discovery section; homepage marketing is not an event dataset. | 24h, disabled |
| url-004 [https://eventfinder.site/](https://eventfinder.site/) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

### Festival and fair directories

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-005 [https://festivalnet.com/](https://festivalnet.com/) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-006 [https://festivaltrekker.com/](https://festivaltrekker.com/) | HTTP 200; wordpress | **annual / editorial guide**: Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |
| url-007 [https://festivalindex.com/en-us](https://festivalindex.com/en-us) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-008 [https://www.countyfairgrounds.net/](https://www.countyfairgrounds.net/) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-009 [https://meetmeatthefair.com/events/all](https://meetmeatthefair.com/events/all) | HTTP 200; wordpress | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

### Conventions and trade shows

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-010 [https://www.tsnn.com/trade-show-calendar](https://www.tsnn.com/trade-show-calendar) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-011 [https://10times.com/](https://10times.com/) | HTTP 403 challenge; custom / inspect | **collection candidate**: Access investigation first. Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-012 [https://tradefest.io/](https://tradefest.io/) | HTTP 200; nextjs | **discovery hub**: Root redirected to /en/home and promotes booth-design companies; use event-specific sections and validate relevance. | 24h, disabled |
| url-013 [https://conventiongrid.com/calendar/](https://conventiongrid.com/calendar/) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-014 [https://thetradeshowcalendar.com/ttn/index.php](https://thetradeshowcalendar.com/ttn/index.php) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-015 [https://conventioncalendar.com/](https://conventioncalendar.com/) | HTTP 200; ConventionCalendar shared publisher | **discovery hub**: Develop one ConventionCalendar adapter, then configure venue collections for New York and Orlando. | 24h, disabled |

### Las Vegas

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-016 [https://www.vegasmeansbusiness.com/destination-calendar/](https://www.vegasmeansbusiness.com/destination-calendar/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-017 [https://www.vegas.com/las-vegas-events/festivals-in-las-vegas/](https://www.vegas.com/las-vegas-events/festivals-in-las-vegas/) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-018 [https://www.lasvegasnevada.gov/Residents/Arts-Culture/Annual-Festivals](https://www.lasvegasnevada.gov/Residents/Arts-Culture/Annual-Festivals) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-019 [https://network.vegas/calendar/](https://network.vegas/calendar/) | HTTP 200; wordpress-the-events-calendar | **tested collection**: Public TEC API returned 10 records across two pages; reuse for category subset instead of scraping twice. | 6h, disabled |
| url-020 [https://network.vegas/calendar/category/event-type/convention/](https://network.vegas/calendar/category/event-type/convention/) | HTTP 200; wordpress-the-events-calendar | **overlapping category view**: Use source-level acquisition with upstream category tags; validate category filtering against this view. | 6h, disabled |
| url-021 [https://networkinvegas.com/calendar/](https://networkinvegas.com/calendar/) | HTTP 200; wordpress-the-events-calendar | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 6h, disabled |
| url-022 [https://events.lasvegascalendars.com/lasvegascalendars/pinboard?tags=Conventions](https://events.lasvegascalendars.com/lasvegascalendars/pinboard?tags=Conventions) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-023 [https://www.eventbrite.com/d/nv--las-vegas/](https://www.eventbrite.com/d/nv--las-vegas/) | HTTP 200; Eventbrite city discovery | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 6h, disabled |

### New York City

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-024 [https://www.nyctourism.com/events/](https://www.nyctourism.com/events/) | HTTP 200; contentful | **collection candidate**: Compare overlap with the NYC events/festivals guide; discover actual query and pagination. | 24h, disabled |
| url-025 [https://www.nyctourism.com/things-to-do/events-and-festivals/](https://www.nyctourism.com/things-to-do/events-and-festivals/) | HTTP 200; contentful | **editorial / discovery guide**: Use as event/detail-page discovery; do not assume all guide entries are dated occurrences. | 168h, disabled |
| url-026 [https://www.nycgovparks.org/events/festivals](https://www.nycgovparks.org/events/festivals) | HTTP 403; custom / inspect | **collection candidate**: Access investigation first. Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-027 [https://www.javitscenter.com/calendar](https://www.javitscenter.com/calendar) | HTTP 429; browser 200; custom / inspect | **browser collection candidate**: Ordinary Playwright navigation returned HTTP 200 after raw HTTP 429; no extractor implemented yet. | 24h, disabled |
| url-028 [https://conventioncalendar.com/us/ny/new-york-city/jacob-javits-center](https://conventioncalendar.com/us/ny/new-york-city/jacob-javits-center) | HTTP 200; ConventionCalendar shared publisher | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-029 [https://www.nyc.com/events/](https://www.nyc.com/events/) | HTTP 403 challenge; custom / inspect | **collection candidate**: Access investigation first. Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-030 [https://www.cityguideny.com/events/?catid=182](https://www.cityguideny.com/events/?catid=182) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-031 [https://nycstreetfairs.com/](https://nycstreetfairs.com/) | HTTP 200 challenge; wordpress | **annual / editorial guide**: Access investigation first. Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |
| url-032 [https://cititour.com/NYC_Events/2026-New-York-City-Street-Fairs/33756](https://cititour.com/NYC_Events/2026-New-York-City-Street-Fairs/33756) | HTTP 403 challenge; custom / inspect | **annual / editorial guide**: Access investigation first. Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |
| url-033 [https://dothisnyc.com/street-fairs-nyc/](https://dothisnyc.com/street-fairs-nyc/) | HTTP 200; wordpress | **annual / editorial guide**: Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |
| url-034 [https://www.eventbrite.com/d/ny--new-york/](https://www.eventbrite.com/d/ny--new-york/) | HTTP 200; Eventbrite city discovery | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 6h, disabled |

### Los Angeles

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-035 [https://www.discoverlosangeles.com/events](https://www.discoverlosangeles.com/events) | HTTP 200; drupal | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 12h, disabled |
| url-036 [https://lacity.gov/calendar](https://lacity.gov/calendar) | HTTP 200; drupal | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 12h, disabled |
| url-037 [https://www.laconventioncenter.com/events](https://www.laconventioncenter.com/events) | HTTP 200; LA convention-center HTML | **overlapping listing**: Use /events/all as the source collection; root listing is a smaller view. | 24h, disabled |
| url-038 [https://www.laconventioncenter.com/events/all](https://www.laconventioncenter.com/events/all) | HTTP 200; LA convention-center HTML | **tested collection**: Playwright found 31 cards; exported 8 dated sample records; details and complete enumeration remain. | 24h, disabled |

### Chicago

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-039 [https://www.choosechicago.com/events/](https://www.choosechicago.com/events/) | HTTP 200; wordpress-the-events-calendar | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 6h, disabled |
| url-040 [https://www.chicago.gov/city/en/depts/dca/provdrs/chicago_festivals.html](https://www.chicago.gov/city/en/depts/dca/provdrs/chicago_festivals.html) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-041 [https://www.chicago.gov/city/en/depts/dca/provdrs/attractions_eventsandexhibitions.html](https://www.chicago.gov/city/en/depts/dca/provdrs/attractions_eventsandexhibitions.html) | HTTP 200; custom / inspect | **editorial / discovery guide**: Follow links to dated event calendars; distinguish exhibitions and attractions from occurrences. | 168h, disabled |
| url-042 [https://www.chicagoparkdistrict.com/events](https://www.chicagoparkdistrict.com/events) | HTTP 200; drupal | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 12h, disabled |

### Houston

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-043 [https://www.visithoustontexas.com/events/](https://www.visithoustontexas.com/events/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-044 [https://www.visithoustontexas.com/events/annual-events/](https://www.visithoustontexas.com/events/annual-events/) | HTTP 200; simpleview | **annual / editorial guide**: Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |
| url-045 [https://www.houstontx.gov/events/](https://www.houstontx.gov/events/) | HTTP 200; custom / inspect | **selected-event index**: Title describes selected events/venues; assess actual dates and outbound event pages before treating it as complete. | 24h, disabled |
| url-046 [https://www.houstontx.gov/abouthouston/annualevents.html](https://www.houstontx.gov/abouthouston/annualevents.html) | HTTP 200; custom / inspect | **annual / editorial guide**: Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |
| url-047 [https://houston.com/events](https://houston.com/events) | HTTP 200; nextjs | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-048 [https://houston.com/festivals](https://houston.com/festivals) | HTTP 200; nextjs | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

### Washington, DC

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-049 [https://washington.org/find-dc-listings/dc-events](https://washington.org/find-dc-listings/dc-events) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-050 [https://washington.org/press/journalist-newsletter/calendar-events](https://washington.org/press/journalist-newsletter/calendar-events) | HTTP 200; simpleview | **press / editorial calendar**: Evaluate date horizon and overlap with the main DC listings; secondary discovery source. | 168h, disabled |
| url-051 [https://eventsdc.com/](https://eventsdc.com/) | HTTP 200; drupal | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 12h, disabled |
| url-052 [https://dc.gov/calendar/month](https://dc.gov/calendar/month) | HTTP 200; drupal | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 12h, disabled |

### Boston

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-053 [https://www.meetboston.com/events/](https://www.meetboston.com/events/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-054 [https://www.boston.gov/events](https://www.boston.gov/events) | HTTP 200; drupal | **tested collection**: Playwright extracted 35 records from two pages; visible date groups and recurring node/date keys validated. | 12h, disabled |
| url-055 [https://www.boston.gov/departments/tourism-sports-and-entertainment](https://www.boston.gov/departments/tourism-sports-and-entertainment) | HTTP 200; drupal | **department information**: Use for discovering department calendars; not an independent feed by default. | 168h, disabled |

### Miami

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-056 [https://www.miamiandbeaches.com/events](https://www.miamiandbeaches.com/events) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-057 [https://www.miamiandbeaches.com/events/annual-events](https://www.miamiandbeaches.com/events/annual-events) | HTTP 200; simpleview | **annual / editorial guide**: Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |

### Seattle

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-058 [https://visitseattle.org/events/](https://visitseattle.org/events/) | HTTP 200; wordpress | **overlapping listing**: Compare archive with main Seattle event search and choose one authoritative enumeration route. | 24h, disabled |
| url-059 [https://visitseattle.org/things-to-do/events/](https://visitseattle.org/things-to-do/events/) | HTTP 200; wordpress | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-060 [https://visitseattle.org/things-to-do/events/festivals/](https://visitseattle.org/things-to-do/events/festivals/) | HTTP 200; wordpress | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-061 [https://visitseattle.org/about-us/citywide-calendar/](https://visitseattle.org/about-us/citywide-calendar/) | HTTP 200; wordpress | **convention collection candidate**: May have a different audience and date horizon from public events; keep a separate collection if verified. | 24h, disabled |
| url-062 [https://www.seattle.gov/event-calendar](https://www.seattle.gov/event-calendar) | HTTP 200; browser 403; trumba | **embedded calendar**: HTML includes Trumba; browser probe received 403. Investigate published embed/feed access, not stealth retries. | 24h, disabled |
| url-063 [https://www.seattle.gov/special-events/plan-an-event/calendar](https://www.seattle.gov/special-events/plan-an-event/calendar) | HTTP 200; trumba | **permit / special-events calendar**: Inspect Trumba embed and event meaning; permit activity is not automatically a public event. | 24h, disabled |

### San Francisco

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-064 [https://www.sftravel.com/explore/events](https://www.sftravel.com/explore/events) | HTTP 403 challenge; custom / inspect | **collection candidate**: Access investigation first. Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-065 [https://portal.sftravel.com/calendar_public/home_sfdc.cfm](https://portal.sftravel.com/calendar_public/home_sfdc.cfm) | HTTP 200; custom / inspect | **separate convention portal**: Separate host/interface from tourism listings; inspect search/form filters and pagination. | 24h, disabled |
| url-066 [https://www.sf.gov/departments--office-mayor/events/calendar](https://www.sf.gov/departments--office-mayor/events/calendar) | HTTP 200; nextjs | **government page requiring validation**: Confirm this route still exposes a useful calendar; HTTP 200 alone does not establish event content. | 24h, disabled |

### Atlanta

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-067 [https://discoveratlanta.com/events/all/](https://discoveratlanta.com/events/all/) | HTTP 403 challenge; custom / inspect | **collection candidate**: Access investigation first. Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-068 [https://discoveratlanta.com/events/festivals/](https://discoveratlanta.com/events/festivals/) | HTTP 403 challenge; custom / inspect | **collection candidate**: Access investigation first. Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-069 [https://www.atlantaga.gov/government/mayor-s-office/executive-offices/office-of-communications/city-calendar](https://www.atlantaga.gov/government/mayor-s-office/executive-offices/office-of-communications/city-calendar) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

### Dallas

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-070 [https://www.visitdallas.com/events/](https://www.visitdallas.com/events/) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-071 [https://www.visitdallas.com/events/annual-events/](https://www.visitdallas.com/events/annual-events/) | HTTP 200; custom / inspect | **annual / editorial guide**: Discover dated occurrences; verify year and source links. Do not generate future dates from an annual tradition. | 168h, disabled |
| url-072 [https://dallascityhall.com/calendar/Pages/default.aspx](https://dallascityhall.com/calendar/Pages/default.aspx) | HTTP 200; custom / inspect | **SharePoint calendar candidate**: Inspect rendered calendar and any supported public feed; validate instance expansion. | 24h, disabled |

### New Orleans

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-073 [https://www.neworleans.com/events/](https://www.neworleans.com/events/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-074 [https://www.neworleans.com/things-to-do/festivals/](https://www.neworleans.com/things-to-do/festivals/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-075 [https://www.neworleans.com/events/year-at-a-glance/](https://www.neworleans.com/events/year-at-a-glance/) | HTTP 200; simpleview | **annual overview**: Use as secondary discovery; reconcile with the main New Orleans calendar. | 168h, disabled |

### Denver

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-076 [https://visitdenver.com/events/](https://visitdenver.com/events/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-077 [https://visitdenver.com/things-to-do/festivals-events/](https://visitdenver.com/things-to-do/festivals-events/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

### Orlando

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-078 [https://www.visitorlando.com/events/](https://www.visitorlando.com/events/) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-079 [https://www.orlando.gov/Events](https://www.orlando.gov/Events) | HTTP 200; opencities | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 12h, disabled |
| url-080 [https://www.downtownorlando.com/Fun/Events](https://www.downtownorlando.com/Fun/Events) | HTTP 200; opencities | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 12h, disabled |
| url-081 [https://events.occc.net/](https://events.occc.net/) | HTTP 200; browser 403; simpleview | **embedded calendar**: HTML suggests Simpleview but browser received 403; inspect embed-source and supported public HTTP feed. | 24h, disabled |

### San Diego

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-082 [https://www.visitsandiego.com/calendar](https://www.visitsandiego.com/calendar) | HTTP 200; custom / inspect | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

## Additional citation-only leads

### Conventions and trade shows

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-083 [https://tradefest.io/en/tag/research](https://tradefest.io/en/tag/research) | HTTP 200; nextjs | **category-specific discovery**: Research-industry tag, not a complete trade-show directory; keep scope explicit. | 24h, disabled |

### Las Vegas

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-084 [https://www.vegasmeansbusiness.com/destination-calendar/?bounds=false&view=grid&sort=date&filter_date_start=1/1/2026&filter_date_end=1/31/2026](https://www.vegasmeansbusiness.com/destination-calendar/?bounds=false&view=grid&sort=date&filter_date_start=1/1/2026&filter_date_end=1/31/2026) | HTTP 200; simpleview | **historical filtered view**: January 2026 filters are already historical; replace with deliberate current/future scope before scheduling. | 24h, disabled |

### New York City

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-085 [https://www.nycgovparks.org/events/festivals/ajax/aggregate/p1](https://www.nycgovparks.org/events/festivals/ajax/aggregate/p1) | HTTP 200 challenge; custom / inspect | **supplemental endpoint candidate**: Access investigation first. An aggregate path returned HTML successfully; validate pagination and dates instead of assuming a documented API. | 24h, disabled |

### Seattle

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-086 [https://visitseattle.org/events/?frm=events&event_type=festivals-special-events](https://visitseattle.org/events/?frm=events&event_type=festivals-special-events) | HTTP 200; wordpress | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

### Denver

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-087 [https://visitdenver.com/events/?filter_categories[0]=63](https://visitdenver.com/events/?filter_categories[0]=63) | HTTP 200; simpleview | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |

### Orlando

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-088 [https://expofp.com/orange-county-convention-center](https://expofp.com/orange-county-convention-center) | HTTP 200; custom / inspect | **venue reference**: Use for venue/source discovery; verify whether it contains independently maintainable dated events. | 168h, disabled |
| url-089 [https://www.ramadaorlando.com/orange-county-convention-center-events/](https://www.ramadaorlando.com/orange-county-convention-center-events/) | HTTP 200; wordpress | **hotel / venue guide**: Secondary reference; prioritize the venue calendar and verify freshness. | 168h, disabled |
| url-090 [https://conventioncalendar.com/us/fl/orlando/orange-county-convention-center](https://conventioncalendar.com/us/fl/orlando/orange-county-convention-center) | HTTP 200; ConventionCalendar shared publisher | **collection candidate**: Inspect event containers, detail pages, identity, pagination, date scope, and any published feed; then implement a bounded adapter probe. | 24h, disabled |
| url-091 [https://www.occc.net/About-Us-Media-Relations-Press-Releases](https://www.occc.net/About-Us-Media-Relations-Press-Releases) | HTTP 200; custom / inspect | **press releases**: Discovery lead for announcements, not a structured schedule. | 168h, disabled |
| url-092 [https://www.wyndhamidriveresort.com/orange-county-convention-center.htm](https://www.wyndhamidriveresort.com/orange-county-convention-center.htm) | HTTP 200; wordpress | **hotel / venue guide**: Secondary venue reference; not a primary calendar without further inspection. | 168h, disabled |
| url-094 [https://www.orlando.gov/Home](https://www.orlando.gov/Home) | HTTP 200; opencities | **homepage**: Discover links only; do not schedule alongside the Orlando Events collection. | 168h, disabled |
| url-095 [https://www.visitorlando.city/events](https://www.visitorlando.city/events) | HTTP 200; simpleview | **separate publisher candidate**: Different domain from visitorlando.com; establish publisher identity, provenance, and overlap. | 24h, disabled |
| url-097 [https://events.occc.net/calendar-embed-source/](https://events.occc.net/calendar-embed-source/) | HTTP 200; simpleview | **embed-source candidate**: Inspect scripts/network or published feed; do not assume the source page itself enumerates events. | 24h, disabled |

### Chicago

| ID and URL | Observation / family hint | Role and next action | Proposed interval |
| --- | --- | --- | --- |
| url-093 [https://www.chicago.gov/city/en/sites/chicagoriverwalk/home/events.html](https://www.chicago.gov/city/en/sites/chicagoriverwalk/home/events.html) | HTTP 200; custom / inspect | **secondary municipal calendar**: Inspect Riverwalk event dates and overlap with other Chicago municipal sources. | 24h, disabled |
| url-096 [https://events.uchicago.edu/](https://events.uchicago.edu/) | HTTP 200; custom / inspect | **university calendar candidate**: Inspect structured calendar/feed, public-attendance scope, and pagination. | 24h, disabled |

## Onboarding batches

1. Finish completeness and detail-page checks for the three tested sources.
2. Validate the shared TEC adapter on networkinvegas.com and choosechicago.com; coalesce the two network.vegas views.
3. Develop and test one Simpleview adapter against one tourism site, then validate each other tenant independently.
4. Add a ConventionCalendar adapter for the main directory and venue pages.
5. Add public-feed/HTML adapters for Drupal, OpenCities, and the two Trumba embeds, allowing site-specific differences.
6. Investigate aggregators, access-blocked sites, and custom calendars individually; no challenge bypass.
7. Use annual guides, press releases, hotel pages, homepages, and year-specific articles as discovery leads; only enable dated, validated collections.

Never activate every URL just because a shared platform hint matches. Each source needs verified pagination, identities, scope, and access.
