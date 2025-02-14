var unit = 'USD', wallet = 'purse', jigsCount = 0, balElem = document.getElementById('bsvBalance'), jigsbtn = document.getElementById('sendjigs'), burnbtn = document.getElementById('burnjigs');
var inputAddr = document.getElementById('purseAddr'), ownerAddr = document.getElementById('ownerAddr'), jigs = [], contracts = [], constructors = [];
Run.util.sha256 = async h => {return new Uint8Array(await crypto.subtle.digest('SHA-256', h))}
const qrCode = (e, value) => {
    let qrAddr = document.getElementById(e);
    qrAddr.innerText = '';
    const qrcode = new QRCode(qrAddr, { width: 78, height: 78 });
    qrcode.makeCode(value);
    const imgs = document.getElementsByTagName('img');
    imgs[2].alt = 'QR';
    imgs[2].style.width = '78px', imgs[2].style.height = '78px';
}
const copyAddr = () => {
    const copyText = wallet === 'purse' ? inputAddr : ownerAddr;
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    document.execCommand("copy");
    alert(`${wallet === 'purse' ? 'Copied PURSE address! Only send BSV to this address!' : 'Copied OWNER address! Only send Tokens/Jigs to this address!'}`)
}
update = u => {
    const storedBalance = parseInt(localStorage.getItem('purseSats') * 100000000);
    const added = u.reduce(((t, e) => t + e.satoshis), 0)
    sync(storedBalance + added);
}
const listenTx = (address, jig) => {
    let centrifuge;
    const filter = outputScript(address);
    if (network === 'main') { centrifuge = new Centrifuge('wss://socket.whatsonchain.com/mempool') }
    else { throw `${network} network not supported.`}
    centrifuge.on('publish', async message => {
        const hex = message.data.hex;
        if (hex.includes(filter)) {
            let u = extractUTXOs(hex, address);
            if (jig) {
                for (let utxo of u) {
                    let j = await run.load(`${utxo.txid}_o${utxo.vout}`);
                    insertJig(j);
                    document.getElementById('list').innerHTML = '';
                    loadAll();
                    //loadToken(j.constructor.location);
                }
            }
            else {
                u.forEach(utxo => addUTXO(utxo))
                update(u);
            }
        }
    });
    centrifuge.on('disconnect', ctx => { console.log('Disconnected: ' + ctx.reason) });
    centrifuge.on('connect', ctx => { console.log('Connected with client ID ' + ctx.client + ' over ' + ctx.transport) });
    centrifuge.connect();
}
const loadToken = async loc => {
    let balance = 0, contract = constructors.find(c => c.origin === loc);
    if (contract?.deps?.Token) {
        const tokens = jigs.filter(jig => jig instanceof contract);
        if (tokens.length) {
            tokens.forEach(coin => { balance += coin.amount });
            addToList(contract, loc, balance);
        }
    }
    else if (contract) {
        const nfts = jigs.filter(jig => jig instanceof contract);
        nfts.forEach(nft => addToList(nft, loc, 0, contract));
    }
}
insertJig = jig => {
    if (typeof jig === 'object') {
        const jigIdx = jigs.findIndex(i => i.location === jig.location);

        //KRG WAS HERE
        //console.log(`${jig.location}`);


        if (jigIdx < 0) { jigs.push(jig) }
        const conIdx = constructors.findIndex(i => i.location === jig.constructor.origin);
        if (conIdx < 0) { constructors.push(jig.constructor) }
        if (!contracts.includes(jig.constructor.origin)) { contracts.push(jig.constructor.origin) }
    }
}
const loadAll = async() => {
    let utxos = await run.blockchain.utxos(run.owner.address), utxoLoc, again = false;
    for (utxo of utxos) {
        try {
            utxoLoc = `${utxo.txid}_o${utxo.vout}`;
            let jig = await run.load(utxoLoc);
            insertJig(jig);
        }
        catch (e) {
            console.log(e);
            const txToTrust = e.toString().substr(166, 64) || e.txid;
            if (txToTrust.length === 64 && trust === "0") {
                if (!banned.includes(txToTrust)) {
                    run.trust(txToTrust);
                    again = true;
                }
            }
        }
    }
    if (again) {
        await loadAll();
        again = false;
    }
    if (contracts && !again) {
        for (let contract of contracts) { await loadToken(contract) }
        localStorage.setItem('contracts', JSON.stringify(contracts));
    }
    document.getElementById('loading').style.display = 'none';
}
const initWallet = () => {
    trustContracts(run);
    inputAddr.value = run.purse.address;
    document.getElementById('sendbsv').addEventListener('click', () => { location.href = './sendbsv.html' })
    document.getElementById('copyAddr').addEventListener('click', copyAddr);
    document.getElementById('ocopyAddr').addEventListener('click', copyAddr);
    balElem.addEventListener('click', switchUnits);
    jigsbtn.addEventListener('click', () => {
        const loc = document.querySelector('input[name="jigs"]:checked').id;
        sendCache(loc);
        location.href = `./send.html?loc=${loc}`;
    });
    burnbtn.addEventListener('click', () => {
        const loc = document.querySelector('input[name="jigs"]:checked').id;
        sendCache(loc);
        location.href = `./burn.html?loc=${loc}`;
    });
    qrCode('qrAddr', run.purse.address);
    listenTx(run.purse.address);
    loadAll();
}
sendCache = loc => {
    const contract = constructors.find(c => c.origin === loc);
    if (contract?.deps?.Token) {
        const sending = jigs.filter(jig => jig instanceof contract);
        let send = [];
        sending.forEach(jig => { send.push(jig.location) });
        localStorage.setItem('sending', JSON.stringify(send));
    }
}
networkSync = async() => {
    const bal = await run.purse.balance();
    bal.utxos.forEach(u => addUTXO(u));
    const res = await exchrate();
    localStorage.setItem('rate', res.rate);
    sync(bal.balance);
}
const balance = async() => {
    let db;
    const bal = await run.purse.balance();
    const res = await exchrate();
    localStorage.setItem('rate', res.rate);
    sync(bal.balance);
    if (bal.utxos.length) {
        clearUTXOs(bal.utxos);
    }
    else { networkSync() }
}
const sync = sats => {
    const s = sats / 100000000;
    const b = (s * localStorage.getItem('rate')).toFixed(2);
    balElem.innerText = `$ ${b}`;
    localStorage.setItem('purseSats', s);
    localStorage.setItem('usdBalance', b);
}
const switchUnits = () => {
    if (unit === 'BSV') {
        balElem.className = 'purseBalance';
        balElem.innerText = `$${localStorage.getItem('usdBalance')}`;
        unit = 'USD';
    }
    else {
        balElem.className = 'purseBalance bsvBalance';
        balElem.innerText = `${localStorage.getItem('purseSats')} BSV`;
        unit = 'BSV';
    }
}
flip = () => {
    if (wallet === 'purse') {
        document.getElementById('purselink').innerHTML = `<img src="images/Ownership.svg" class="ownerlogo" alt="Owner">`;
        document.getElementById('flipInner').style.transform = 'rotateY(180deg)';
        qrCode('oqrAddr', run.owner.address);
        ownerAddr.value = run.owner.address;
        document.getElementById('jigBalance').innerText = `${jigsCount} jigs`;
        wallet = 'jigs';
    }
    else {
        document.getElementById('purselink').innerHTML = `<img src="images/Purse.svg" class="purselogo" alt="Purse">`;
        document.getElementById('flipInner').style.transform = 'rotateY(360deg)';
        qrCode('qrAddr', run.purse.address);
        inputAddr.value = run.purse.address;
        wallet = 'purse';
    }
}
document.getElementById('flip').addEventListener('click', flip);
document.getElementById('oflip').addEventListener('click', flip);
if (script) {
    script.onload = () => {
        const mnemonic = bsvMnemonic.fromRandom();
        const hdPrivKey = bsv.HDPrivateKey.fromSeed(mnemonic.toSeed(), network === 'test' ? 'testnet' : '');
        const owner = hdPrivKey.deriveChild('m/0/0').privateKey.toString();
        const purse = hdPrivKey.deriveChild('m/0/1').privateKey.toString();
        localStorage.setItem('seed', mnemonic.toString());
        localStorage.setItem('purseKey', purse);
        localStorage.setItem('ownerKey', owner);
        localStorage.setItem('hasBackedUp', 'false');
        initRun();
        initWallet();
        balance();
    }
}
else {
    document.getElementById('loading').style.display = 'inline-block';
    if (localStorage.getItem('hasBackedUp') === 'false') {alert('Please backup your wallet!')}
    initRun();
    initWallet();
    balance();
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.get('flip') && localStorage.ownerKey) { setTimeout(() => {flip()}, 600) }
}
const addToList = (contract, loc, balance, def) => {
    const contractId = def ? def.origin : contract.origin;
    const exists = document.getElementById(`${contractId}_${loc}element`);
    if (exists) { return }
    loc = balance > 0 ? loc : contract.location;
    jigsCount++;
    let li = document.createElement('li');
    li.className = 'element';
    li.id = `${contractId}_${loc}element`;
    let radio = document.createElement('input');
    radio.type = 'radio';
    radio.className = 'jig';
    radio.id = loc;
    radio.name = 'jigs';
    radio.onchange = function() { highlight(this, balance, contractId, loc) }
    let label = document.createElement('label');
    label.htmlFor = loc;
    label.className = 'select';
    li.appendChild(radio);
    let emojiSpan = document.createElement('span');
    emojiSpan.className = "emoji";
    emojiSpan = setImage(emojiSpan, contract?.metadata, def, contract.origin);
    label.appendChild(emojiSpan);
    let nameSpan = document.createElement('span');
    nameSpan.className = 'contractName';
    nameSpan = setName(nameSpan, contract, def, loc, network, def ? true : false);
    label.appendChild(nameSpan);
    let contractSpan = document.createElement('span');
    contractSpan.className = 'contractID';
    contractSpan.innerHTML = `<a href="https://run.network/explorer/?query=${contractId}&network=${network}" target=_blank>
    ${contractId.slice(0, 5)}..${contractId.slice(-5)}</a>`;
    label.appendChild(contractSpan);
    if (balance) {
        let bal = document.createElement('span');
        bal.className = "tokenBalance";
        if (contract.decimals > 0) {
            balance = balance / Math.pow(10, contract.decimals);
        }
        bal.innerText = balance;
        label.appendChild(bal);
    }
    li.appendChild(label);
    document.getElementById('list').appendChild(li);
}
const highlight = (el, ft, origin, location) => {
    jigsbtn.style.background = '#F4C51D';
    burnbtn.style.background = '#F4C51D';
    const radios = document.querySelectorAll(`input[name='jigs']`);
    for (let i = 0; i < radios.length; i++) {
        document.getElementById(`${radios[i].parentElement.id}`).style.background = '';
    }
    if (location) {
        document.getElementById(`${origin}_${location}element`).style.background = 'rgba(244, 197, 29, 0.5)';
    } else {
        document.getElementById(`${origin}element`).style.background = 'rgba(244, 197, 29, 0.5)';
    }

}