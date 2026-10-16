// Shared by server.js and the browser's demo mode.
// Sample data around Casper, Wyoming. Every sample is flagged `sample: true`
// and labelled "SAMPLE" in the UI so nobody mistakes it for a real dog.
const H = 3600 * 1000;
function ago(hours) { return new Date(Date.now() - hours * H).toISOString(); }

function buildSeed() {
  const base = {
    reunited: false, reunitedAt: null, linkedTo: null, sample: true, ownerTokenHash: null,
    contactEmail: '', sightings: [],
  };
  return [
    {
      ...base, id: 'sample-biscuit', status: 'lost', name: 'Biscuit', breed: 'Golden Retriever',
      color: 'Golden, red collar', description: 'SAMPLE REPORT. Friendly, answers to "Biscuit". Slipped her leash near the playground.',
      photo: 'samples/dog-1.svg', seenAt: ago(20), createdAt: ago(19), lat: 42.8418, lng: -106.3185,
      locationLabel: 'Washington Park', contactName: 'Sample Owner (demo)', contactPhone: '(307) 555-0101',
      sightings: [
        { id: 'sg1', lat: 42.8462, lng: -106.3247, seenAt: ago(14), note: 'SAMPLE: Golden dog with red collar trotting west on 12th St.', contactName: 'Demo neighbor', contact: '(307) 555-0150', photo: null, reportId: null, createdAt: ago(13.5) },
        { id: 'sg2', lat: 42.8519, lng: -106.3301, seenAt: ago(6), note: 'SAMPLE: Saw her drinking from a sprinkler, wouldn\'t come close.', contactName: 'Demo walker', contact: 'demo@example.com', photo: null, reportId: null, createdAt: ago(5.8) },
      ],
    },
    {
      ...base, id: 'sample-ranger', status: 'lost', name: 'Ranger', breed: 'Blue Heeler (Australian Cattle Dog)',
      color: 'Blue-gray speckled, black patch over left eye', description: 'SAMPLE REPORT. Shy with strangers, microchipped. Got out through the back gate.',
      photo: 'samples/dog-2.svg', seenAt: ago(44), createdAt: ago(43), lat: 42.8505, lng: -106.3895,
      locationLabel: 'Paradise Valley', contactName: 'Sample Owner (demo)', contactPhone: '(307) 555-0102',
    },
    {
      ...base, id: 'sample-pepper', status: 'lost', name: 'Pepper', breed: 'Border Collie mix',
      color: 'Black and white, fluffy tail', description: 'SAMPLE REPORT. Very fast, may be scared of fireworks. Last seen near the river trail.',
      photo: 'samples/dog-3.svg', seenAt: ago(6), createdAt: ago(5), lat: 42.8628, lng: -106.3420,
      locationLabel: 'Platte River Trails', contactName: 'Sample Owner (demo)', contactPhone: '', contactEmail: 'pepper.demo@example.com',
    },
    {
      ...base, id: 'sample-spot-lab', status: 'spotted', name: '', breed: 'Labrador (maybe)',
      color: 'Chocolate brown, no collar', description: 'SAMPLE REPORT. Wandering the parking lot, seemed hungry. Couldn\'t catch him.',
      photo: 'samples/dog-4.svg', seenAt: ago(3), createdAt: ago(2.5), lat: 42.8462, lng: -106.2655,
      locationLabel: 'Eastridge Mall area', contactName: 'Sample Finder (demo)', contactPhone: '(307) 555-0104',
    },
    {
      ...base, id: 'sample-spot-husky', status: 'spotted', name: '', breed: 'Husky',
      color: 'Gray and white, blue eyes, green collar', description: 'SAMPLE REPORT. Found and safe in my yard. Please call to identify!',
      photo: 'samples/dog-5.svg', seenAt: ago(9), createdAt: ago(8.5), lat: 42.8350, lng: -106.3350,
      locationLabel: 'Near Casper College', contactName: 'Sample Finder (demo)', contactPhone: '(307) 555-0105',
    },
    {
      ...base, id: 'sample-daisy', status: 'lost', name: 'Daisy', breed: 'Dachshund',
      color: 'Red-brown, short hair', description: 'SAMPLE REPORT. Home safe! Thanks to everyone who shared.',
      photo: 'samples/dog-6.svg', seenAt: ago(70), createdAt: ago(69), lat: 42.8700, lng: -106.3060,
      locationLabel: 'North Casper', contactName: 'Sample Owner (demo)', contactPhone: '(307) 555-0106',
      reunited: true, reunitedAt: ago(30),
    },
  ];
}
// Works in Node (server.js) and in the browser (demo mode on GitHub Pages / the Android app)
if (typeof module !== 'undefined' && module.exports) module.exports = { buildSeed };
else window.buildSeed = buildSeed;
