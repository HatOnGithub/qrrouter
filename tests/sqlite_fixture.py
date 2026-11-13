"""Read and seed persisted service state for gateway authorization/recovery fixtures."""
import json
import sqlite3
from contextlib import closing

MAPS = ('items', 'batches', 'personal_warehouses', 'location_label_settings', 'location_levels')


def read_state(path):
    state = {key: {} for key in MAPS}
    with closing(sqlite3.connect(path)) as connection, connection:
        for collection, key, document in connection.execute('SELECT collection, key, document FROM records'):
            target = state if collection == 'metadata' else state[collection]
            target[key] = json.loads(document)
        state['history'] = [json.loads(row[0]) for row in connection.execute('SELECT document FROM history ORDER BY id')]
    return state


def write_state(path, state):
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute('DELETE FROM records')
        connection.execute('DELETE FROM history')
        for key, value in state.items():
            if key == 'history':
                connection.executemany('INSERT INTO history(document) VALUES(?)', [(json.dumps(entry),) for entry in value])
            elif key in MAPS:
                connection.executemany('INSERT INTO records(collection,key,document) VALUES(?,?,?)',
                                       [(key, code, json.dumps(item)) for code, item in value.items()])
            else:
                connection.execute('INSERT INTO records(collection,key,document) VALUES(?,?,?)',
                                   ('metadata', key, json.dumps(value)))
