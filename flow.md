There are three types of communications between primary and secondary devices.

1. Acknowledged - Primary dictates something to secondary, and expects a response back when complete
2. Silent - Primary dictates something to secondary and does NOT expect a respone back when complete
3. Update - Secondary reports back data without being prompted by primary

Synapse-Control handles all of these slightly differently.

1. Setup

Create a synapse-control object, handing it a serial connection

Add a series of controls - acknowledged, silent, update

2. That's it!