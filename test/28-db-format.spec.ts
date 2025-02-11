import { expect } from 'chai';
import { isRight } from 'fp-ts/lib/Either';
import * as sinon from 'sinon';
import App from '../src/compose/app';
import Network from '../src/compose/network';
import * as config from '../src/config';
import * as dbFormat from '../src/device-state/db-format';
import log from '../src/lib/supervisor-console';
import { TargetApps } from '../src/types/state';
import * as dbHelper from './lib/db-helper';

function getDefaultNetwork(appId: number) {
	return {
		default: Network.fromComposeObject('default', appId, 'deadbeef', {}),
	};
}

describe('db-format', () => {
	let testDb: dbHelper.TestDatabase;
	let apiEndpoint: string;
	before(async () => {
		testDb = await dbHelper.createDB();

		await config.initialized;
		// Prevent side effects from changes in config
		sinon.stub(config, 'on');

		// TargetStateCache checks the API endpoint to
		// store and invalidate the cache
		// TODO: this is an implementation detail that
		// should not be part of the test suite. We need to change
		// the target state architecture for this
		apiEndpoint = await config.get('apiEndpoint');

		// disable log output during testing
		sinon.stub(log, 'debug');
		sinon.stub(log, 'warn');
		sinon.stub(log, 'info');
		sinon.stub(log, 'event');
		sinon.stub(log, 'success');
	});

	after(async () => {
		try {
			await testDb.destroy();
		} catch (e) {
			/* noop */
		}
		sinon.restore();
	});

	afterEach(async () => {
		await testDb.reset();
	});

	it('converts target apps into the database format', async () => {
		await dbFormat.setApps(
			{
				deadbeef: {
					id: 1,
					name: 'test-app',
					class: 'fleet',
					releases: {
						one: {
							id: 1,
							services: {
								ubuntu: {
									id: 1,
									image_id: 1,
									image: 'ubuntu:latest',
									environment: {},
									labels: { 'my-label': 'true' },
									composition: {
										command: ['sleep', 'infinity'],
									},
								},
							},
							volumes: {},
							networks: {},
						},
					},
				},
			},
			'local',
		);

		const [app] = await testDb.models('app').where({ uuid: 'deadbeef' });
		expect(app).to.not.be.undefined;
		expect(app.name).to.equal('test-app');
		expect(app.releaseId).to.equal(1);
		expect(app.commit).to.equal('one');
		expect(app.appId).to.equal(1);
		expect(app.source).to.equal('local');
		expect(app.uuid).to.equal('deadbeef');
		expect(app.isHost).to.equal(0);
		expect(app.services).to.equal(
			'[{"image":"ubuntu:latest","environment":{},"labels":{"my-label":"true"},"composition":{"command":["sleep","infinity"]},"appId":1,"appUuid":"deadbeef","releaseId":1,"commit":"one","imageId":1,"serviceId":1,"serviceName":"ubuntu"}]',
		);
		expect(app.volumes).to.equal('{}');
		expect(app.networks).to.equal('{}');
	});

	it('should retrieve a single app from the database', async () => {
		await dbFormat.setApps(
			{
				deadbeef: {
					id: 1,
					name: 'test-app',
					class: 'fleet',
					releases: {
						one: {
							id: 1,
							services: {
								ubuntu: {
									id: 1,
									image_id: 1,
									image: 'ubuntu:latest',
									environment: {},
									labels: { 'my-label': 'true' },
									composition: {
										command: ['sleep', 'infinity'],
									},
								},
							},
							volumes: {},
							networks: {},
						},
					},
				},
			},
			apiEndpoint,
		);

		const app = await dbFormat.getApp(1);
		expect(app).to.be.an.instanceOf(App);
		expect(app).to.have.property('appId').that.equals(1);
		expect(app).to.have.property('commit').that.equals('one');
		expect(app).to.have.property('appName').that.equals('test-app');
		expect(app).to.have.property('source').that.equals(apiEndpoint);
		expect(app).to.have.property('services').that.has.lengthOf(1);
		expect(app).to.have.property('volumes').that.deep.equals({});
		expect(app)
			.to.have.property('networks')
			.that.deep.equals(getDefaultNetwork(1));

		const [service] = app.services;
		expect(service).to.have.property('appId').that.equals(1);
		expect(service).to.have.property('serviceId').that.equals(1);
		expect(service).to.have.property('imageId').that.equals(1);
		expect(service).to.have.property('releaseId').that.equals(1);
		expect(service.config)
			.to.have.property('image')
			.that.equals('ubuntu:latest');
		expect(service.config)
			.to.have.property('labels')
			.that.deep.includes({ 'my-label': 'true' });
		expect(service.config)
			.to.have.property('command')
			.that.deep.equals(['sleep', 'infinity']);
	});

	it('should retrieve multiple apps from the database', async () => {
		await dbFormat.setApps(
			{
				deadbeef: {
					id: 1,
					name: 'test-app',
					class: 'fleet',
					releases: {
						one: {
							id: 1,
							services: {
								ubuntu: {
									id: 1,
									image_id: 1,
									image: 'ubuntu:latest',
									environment: {},
									labels: {},
									composition: {
										command: ['sleep', 'infinity'],
									},
								},
							},
							volumes: {},
							networks: {},
						},
					},
				},
				deadc0de: {
					id: 2,
					name: 'other-app',
					class: 'app',
					releases: {
						two: {
							id: 2,
							services: {},
							volumes: {},
							networks: {},
						},
					},
				},
			},
			apiEndpoint,
		);

		const apps = Object.values(await dbFormat.getApps());
		expect(apps).to.have.lengthOf(2);

		const [app, otherapp] = apps;
		expect(app).to.be.an.instanceOf(App);
		expect(app).to.have.property('appId').that.equals(1);
		expect(app).to.have.property('commit').that.equals('one');
		expect(app).to.have.property('appName').that.equals('test-app');
		expect(app).to.have.property('source').that.equals(apiEndpoint);
		expect(app).to.have.property('services').that.has.lengthOf(1);
		expect(app).to.have.property('volumes').that.deep.equals({});
		expect(app)
			.to.have.property('networks')
			.that.deep.equals(getDefaultNetwork(1));

		expect(otherapp).to.have.property('appId').that.equals(2);
		expect(otherapp).to.have.property('commit').that.equals('two');
		expect(otherapp).to.have.property('appName').that.equals('other-app');
	});

	it('should retrieve non-fleet apps from the database if local mode is set', async () => {
		await dbFormat.setApps(
			{
				deadbeef: {
					id: 1,
					name: 'test-app',
					class: 'fleet',
					releases: {
						one: {
							id: 1,
							services: {
								ubuntu: {
									id: 1,
									image_id: 1,
									image: 'ubuntu:latest',
									environment: {},
									labels: {},
									composition: {
										command: ['sleep', 'infinity'],
									},
								},
							},
							volumes: {},
							networks: {},
						},
					},
				},
				deadc0de: {
					id: 2,
					name: 'other-app',
					class: 'app',
					releases: {
						two: {
							id: 2,
							services: {},
							volumes: {},
							networks: {},
						},
					},
				},
			},
			apiEndpoint,
		);

		// Once local mode is set to true, only 'other-app' should be returned
		// as part of the target
		await config.set({ localMode: true });

		const apps = Object.values(await dbFormat.getApps());
		expect(apps).to.have.lengthOf(1);

		const [app] = apps;
		expect(app).to.be.an.instanceOf(App);
		expect(app).to.have.property('appId').that.equals(2);
		expect(app).to.have.property('commit').that.equals('two');
		expect(app).to.have.property('appName').that.equals('other-app');

		// Set the app as local now
		await dbFormat.setApps(
			{
				deadbeef: {
					id: 1,
					name: 'test-app',
					class: 'fleet',
					releases: {
						one: {
							id: 1,
							services: {
								ubuntu: {
									id: 1,
									image_id: 1,
									image: 'ubuntu:latest',
									environment: {},
									labels: {},
									composition: {
										command: ['sleep', 'infinity'],
									},
								},
							},
							volumes: {},
							networks: {},
						},
					},
				},
			},
			'local',
		);

		// Now both apps should be returned
		const newapps = Object.values(await dbFormat.getApps());
		expect(newapps).to.have.lengthOf(2);

		const [newapp, otherapp] = newapps;
		expect(newapp).to.be.an.instanceOf(App);
		expect(newapp).to.have.property('appId').that.equals(1);
		expect(newapp).to.have.property('commit').that.equals('one');
		expect(newapp).to.have.property('appName').that.equals('test-app');
		expect(newapp).to.have.property('source').that.equals('local');
		expect(newapp).to.have.property('services').that.has.lengthOf(1);
		expect(newapp).to.have.property('volumes').that.deep.equals({});
		expect(newapp)
			.to.have.property('networks')
			.that.deep.equals(getDefaultNetwork(1));

		expect(otherapp).to.have.property('appId').that.equals(2);
		expect(otherapp).to.have.property('commit').that.equals('two');
		expect(otherapp).to.have.property('appName').that.equals('other-app');
	});

	it('should retrieve app target state from database', async () => {
		const srcApps: TargetApps = {
			deadbeef: {
				id: 1,
				name: 'test-app',
				class: 'fleet',
				is_host: false,
				releases: {
					one: {
						id: 1,
						services: {
							ubuntu: {
								id: 1,
								image_id: 1,
								image: 'ubuntu:latest',
								environment: {},
								labels: { 'my-label': 'true' },
								composition: {
									command: ['sleep', 'infinity'],
								},
							},
						},
						volumes: {},
						networks: {},
					},
				},
			},
			deadc0de: {
				id: 2,
				name: 'other-app',
				class: 'app',
				is_host: false,
				releases: {
					two: {
						id: 2,
						services: {},
						volumes: {},
						networks: {},
					},
				},
			},
		};

		await dbFormat.setApps(srcApps, apiEndpoint);
		const result = await dbFormat.getTargetJson();
		expect(
			isRight(TargetApps.decode(result)),
			'resulting target apps is a valid TargetApps object',
		);
		expect(result).to.deep.equal(srcApps);
	});
});
